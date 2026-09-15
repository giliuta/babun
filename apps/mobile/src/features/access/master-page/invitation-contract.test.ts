import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { invitationErrorMessage } from "../../settings/invitation-flow";
import {
  createInvitationArgs,
  invitationRefusalText,
  invitationRowPatch,
  isEmailRefusal,
  isInvitationGone,
  MasterInvitationError,
  parseSavedInvitation,
  updateInvitationArgs,
} from "./invitation-contract";
import {
  draftFromInvitation,
  emptyMasterDraft,
  invitationRequest,
  toggleTeam,
  withLevel,
} from "./master-draft";

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../supabase/migrations/20260915110000_invitation_carries_card_calendars_and_rights.sql",
);

/** Имена аргументов функции — из текста миграции, а не из памяти. */
function sqlArgs(fn: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = new RegExp(
    `create or replace function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`,
    "i",
  ).exec(sql);
  assert.ok(match, `в миграции нет ${fn}`);
  return [...(match[1] ?? "").matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1] ?? "");
}

/** Каждый отказ миграции с `hint` — пара «строка базы, hint». `%` заменён
 *  латинским словом: сырая строка базы тогда видна по латинице. */
function sqlRefusals(): { message: string; hint: string }[] {
  const sql = readFileSync(MIGRATION, "utf8");
  return [...sql.matchAll(/raise exception '([^']+)'[^;]*?hint = '([^']+)'/g)].map((m) => ({
    message: (m[1] ?? "").replaceAll("%", "clients"),
    hint: m[2] ?? "",
  }));
}

const REGISTRY: AccessBlock[] = (
  [
    ["calendar.records", "calendar", "calendar", ["off", "read", "write"], 10],
    ["calendar.create", "calendar", "calendar", ["off", "write"], 20],
    ["clients", "clients", "company", ["off", "read", "write"], 210],
    ["clients.scope", "clients", "company", ["own", "all"], 220],
  ] as const
).map(([key, area, scope, levels, position]) => ({
  key,
  area,
  scope,
  levels: levels as readonly AccessLevel[],
  title: key,
  ownerOnly: false,
  live: false,
  position,
}));

const block = (key: string): AccessBlock => {
  const found = REGISTRY.find((candidate) => candidate.key === key);
  if (!found) throw new Error(key);
  return found;
};

const samePhone = (value: string) => value.trim() || null;

function sampleRequest() {
  let draft = emptyMasterDraft("team-1");
  draft = { ...draft, name: " Dmitry ", email: "dmitry@example.com", phone: "+35799123456" };
  draft = { ...draft, title: "Техник", color: "#FF9500" };
  draft = toggleTeam(draft, "team-2");
  draft = withLevel(draft, block("calendar.records"), "read", "team-1");
  draft = withLevel(draft, block("calendar.records"), "write", "team-2");
  draft = withLevel(draft, block("clients"), "read", null);
  return invitationRequest(draft, REGISTRY, samePhone);
}

describe("приглашение с карточкой — аргументы сервера", () => {
  test("create_invitation получает только аргументы из миграции, без карточки сотрудника", () => {
    const sent = Object.keys(createInvitationArgs(sampleRequest())).sort();
    const declared = sqlArgs("create_invitation");
    assert.deepEqual(
      sent.filter((name) => !declared.includes(name)),
      [],
      "аргумент, которого сервер не знает",
    );
    assert.deepEqual(
      declared.filter((name) => !sent.includes(name)),
      ["p_master_id"],
    );
  });

  test("update_invitation получает ровно свои семь аргументов", () => {
    assert.deepEqual(
      Object.keys(updateInvitationArgs("inv-1", sampleRequest())).sort(),
      [...sqlArgs("update_invitation")].sort(),
    );
  });

  test("почта приведена, домашний календарь первым, пустое имя не шлётся", () => {
    const args = createInvitationArgs({
      ...sampleRequest(),
      email: "  Dmitry@Example.COM ",
      fullName: "",
    });
    assert.equal(args.p_email, "dmitry@example.com");
    assert.equal(args.p_role, "master");
    assert.equal(args.p_team_id, "team-1");
    assert.deepEqual(args.p_team_ids, ["team-1", "team-2"]);
    assert.equal(args.p_full_name, null);
  });

  test("правка в кэше читается обратно тем же приглашением", () => {
    const request = sampleRequest();
    const row = {
      id: "inv-1",
      email: "dmitry@example.com",
      team_id: "old",
      ...invitationRowPatch(request),
    };
    const back = invitationRequest(draftFromInvitation(row), REGISTRY, samePhone);
    assert.deepEqual(back, request);
  });

  test("ответ сервера без токена — ошибка, полный — приглашение", () => {
    const saved = {
      id: "inv-1",
      tenant_id: "tenant-1",
      email: "dmitry@example.com",
      role: "master",
      master_id: null,
      token: "t".repeat(32),
      expires_at: "2026-09-22T00:00:00Z",
      created_at: "2026-09-15T00:00:00Z",
      team_ids: ["team-1"],
    };
    assert.equal(parseSavedInvitation(saved).id, "inv-1");
    assert.throws(() => parseSavedInvitation({ ...saved, token: undefined }));
    assert.throws(() => parseSavedInvitation([saved]));
  });
});

describe("отказы приглашения", () => {
  test("почту красят только отказы про почту", () => {
    assert.equal(isEmailRefusal("invalid invitation email"), true);
    assert.equal(isEmailRefusal("this account already has access to the tenant"), true);
    assert.equal(isEmailRefusal("invalid invitation phone"), false);
  });

  test("приглашения больше нет — только по hint сервера", () => {
    const gone = new MasterInvitationError({ message: "invitation expired", hint: "invite:not_pending" });
    const missing = new MasterInvitationError({ message: "invitation not found", hint: "invite:not_found" });
    const field = new MasterInvitationError({ message: "invalid invitation phone" });
    assert.equal(isInvitationGone(gone), true);
    assert.equal(isInvitationGone(missing), true);
    assert.equal(isInvitationGone(field), false);
    assert.equal(isInvitationGone(new Error("invitation not found")), false);
  });

  test("каждый отказ миграции с hint назван словами — и по hint, и по строке базы", () => {
    const refusals = sqlRefusals();
    assert.ok(
      refusals.some((refusal) => refusal.hint === "access:bad_team"),
      "в миграции не нашлось отказов с hint",
    );
    for (const { message, hint } of refusals) {
      const text = invitationRefusalText(new MasterInvitationError({ message, hint }));
      assert.notEqual(text, message, `${hint}: сырая строка базы`);
      assert.doesNotMatch(text, /[A-Za-z]/, `${hint}: латиница в «${text}»`);
      assert.notEqual(invitationErrorMessage(message), message, `запасной путь не знает «${message}»`);
    }
  });

  test("новые отказы сервера названы словами поля", () => {
    assert.match(invitationErrorMessage("invitation job title is too long"), /Должность/);
    assert.match(invitationErrorMessage("invalid invitation colour"), /цвет/);
    // Строка — из миграции, как имена аргументов: придуманная «…или в архиве»
    // проходила тест, а настоящий отказ доходил до владельца строкой базы.
    const badTeam = /raise exception '(календарь не из этой компании)'[^;]*access:bad_team/.exec(
      readFileSync(MIGRATION, "utf8"),
    )?.[1];
    assert.ok(badTeam, "в миграции нет отказа access:bad_team про календарь");
    assert.equal(
      invitationErrorMessage(badTeam),
      "Этого календаря больше нет — откройте карточку ещё раз.",
    );
    assert.doesNotMatch(invitationErrorMessage(badTeam), /архив/);
    assert.match(invitationErrorMessage("человек не прикреплён к календарю"), /календарях мастера/);
    assert.match(invitationErrorMessage("блок owner.access выдаётся только владельцу"), /только у владельца/);
    assert.match(invitationErrorMessage("у блока clients нет положения own"), /Права не сохранились/);
    assert.match(invitationErrorMessage("only an owner can update invitations"), /Менять приглашения/);
    assert.match(invitationErrorMessage("only an owner can create invitations"), /Создавать приглашения/);
  });
});
