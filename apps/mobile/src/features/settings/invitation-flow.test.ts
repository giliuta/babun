import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  invitationErrorMessage,
  invitationSignupErrorMessage,
  invitationPath,
  invitationShareText,
  isInvitableRole,
  isInvitationEmail,
  isInvitationToken,
  normalizeInvitationEmail,
  seededInvitationRole,
} from "./invitation-flow";

describe("mobile invitation flow", () => {
  test("accepts exact 192-bit URL-safe tokens and rejects weak links", () => {
    const token = "AbCdEf0123456789_-AbCdEf01234567";
    assert.equal(token.length, 32);
    assert.equal(isInvitationToken(token), true);
    assert.equal(invitationPath(token), `/invite/${token}`);
    assert.equal(isInvitationToken("short-token"), false);
    assert.equal(isInvitationToken(`${token}!`), false);
  });

  test("normalizes email and limits invitations to operational roles", () => {
    assert.equal(normalizeInvitationEmail("  USER@Example.COM "), "user@example.com");
    assert.equal(isInvitationEmail("user@example.com"), true);
    assert.equal(isInvitationEmail("owner@localhost"), false);
    assert.equal(isInvitableRole("dispatcher"), true);
    assert.equal(isInvitableRole("master"), true);
    assert.equal(isInvitableRole("owner"), false);
  });

  test("renders a signed mobile share message and friendly failures", () => {
    const text = invitationShareText({
      tenantName: "AirFix",
      url: "babun://invite/token",
    });
    assert.match(text, /AirFix/);
    assert.doesNotMatch(text, /рол/i);
    assert.match(text, /babun:\/\/invite\/token/);
    assert.match(
      invitationErrorMessage("invitation email does not match"),
      /другой email/,
    );
    assert.match(invitationErrorMessage("invitation expired"), /истёк/);
    assert.match(invitationErrorMessage("invite:email_not_confirmed"), /Подтвердите почту/);
    assert.match(
      invitationErrorMessage("finish company setup before inviting employees"),
      /завершите настройку компании/,
    );
  });
});

// ЭТАП 0(ж) ПЛАНА ДОСТУПА: роль едет вместе с переходом при приёме приглашения.
describe("роль при приёме приглашения", () => {
  test("ответ сервера важнее роли из приглашения", () => {
    assert.equal(seededInvitationRole("dispatcher", "master"), "dispatcher");
    assert.equal(seededInvitationRole("owner", "master"), "owner");
  });
  test("сервер не ответил — роль из приглашения", () => {
    assert.equal(seededInvitationRole(undefined, "master"), "master");
    assert.equal(seededInvitationRole(undefined, "dispatcher"), "dispatcher");
  });
  test("сервер сказал «не состоит» — роль не засевается", () => {
    assert.equal(seededInvitationRole(null, "master"), undefined);
  });
  test("незнакомые значения не проходят", () => {
    assert.equal(seededInvitationRole("admin", "boss"), undefined);
    assert.equal(seededInvitationRole(undefined, "owner"), undefined);
    assert.equal(seededInvitationRole(undefined, undefined), undefined);
  });
  test("приём приглашения спрашивает роль у новой компании и передаёт её в переход", () => {
    const source = readFileSync(join(__dirname, "invitations.ts"), "utf8");
    assert.match(source, /tenantBoundClient\(tenantId\)\.rpc\("current_user_role"\)/);
    assert.match(source, /switchTenant\(tenantId, \{ onboarded: true, role \}\)/);
  });
});

// ОТКАЗЫ ПРИГЛАШЕНИЯ ПРО КАЛЕНДАРЬ говорят правду (14.09): архив при приёме,
// архив при создании, мастер без календаря. Общие ветки «истёк» и «не найдено»
// их больше не глотают, а регистрация по ссылке называет причину.
describe("отказы приглашения про календарь", () => {
  test("архивный календарь при приёме — просьба о новом приглашении", () => {
    assert.equal(
      invitationErrorMessage("invitation calendar is archived"),
      "Календарь приглашения в архиве — попросите новое приглашение.",
    );
  });
  test("архивный календарь при создании — не «приглашение не найдено»", () => {
    const text = invitationErrorMessage("calendar not found or archived");
    assert.equal(text, "Этот календарь в архиве — пригласить в него нельзя.");
    assert.doesNotMatch(text, /не найдено/);
  });
  test("мастер без календаря и карточки — просьба выбрать календарь", () => {
    assert.equal(
      invitationErrorMessage(
        "master invitation requires a calendar or an employee card",
      ),
      "Выберите календарь, в который зовёте мастера.",
    );
  });
  test("регистрация по ссылке: общий отказ базы — приглашение больше не действует", () => {
    assert.equal(
      invitationSignupErrorMessage("Database error saving new user"),
      "Приглашение больше не действует — попросите владельца отправить новое.",
    );
    assert.equal(invitationSignupErrorMessage("User already registered"), null);
    assert.equal(invitationSignupErrorMessage(undefined), null);
  });
});
