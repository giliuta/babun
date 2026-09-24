import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { levelOf, type AccessBlock, type AccessLevel, type MemberAccessMap } from "../access-map";
import { blankMasterDraft, calendarRightsLine, visibleLevel } from "./master-draft";
import { withMemberChanges } from "./rights-rows";
import {
  PRESETS,
  matchedPreset,
  presetChanges,
  presetDraft,
  presetLevel,
  snapshotChanges,
} from "./presets";

// Реестр — выдержка из боевого после STORY-088 (волна 1): живые календарные
// и денежные, клиенты; неживой «Календарь и записи» и «только владелец».
const block = (
  key: string,
  area: AccessBlock["area"],
  scope: AccessBlock["scope"],
  levels: AccessLevel[],
  live = true,
  ownerOnly = false,
): AccessBlock => ({ key, area, scope, levels, title: key, ownerOnly, live, position: 0 });

const REGISTRY: AccessBlock[] = [
  block("calendar.records", "calendar", "calendar", ["off", "read", "write"], false),
  block("calendar.create", "calendar", "calendar", ["off", "write"]),
  block("calendar.events", "calendar", "calendar", ["off", "read", "write"]),
  block("record.status", "calendar", "calendar", ["off", "read", "write"]),
  block("record.team", "calendar", "calendar", ["read", "write"]),
  block("record.object", "calendar", "calendar", ["off", "read", "write"]),
  block("record.services", "calendar", "calendar", ["off", "read"]),
  block("finance.operations", "finance", "calendar", ["off", "read", "write"]),
  block("finance.vat", "finance", "company", ["off", "read", "write"]),
  block("clients", "clients", "company", ["off", "read", "write"]),
  block("clients.scope", "clients", "company", ["own", "all"]),
  block("clients.contacts", "clients", "company", ["off", "read"]),
  block("owner.billing", "owner", "company", ["off"], false, true),
];
const byKey = (key: string) => REGISTRY.find((b) => b.key === key)!;

describe("наборы прав", () => {
  test("директор — самое сильное положение каждого блока, «Все» клиенты", () => {
    assert.equal(presetLevel(byKey("calendar.create"), "director"), "write");
    assert.equal(presetLevel(byKey("record.services"), "director"), "read");
    assert.equal(presetLevel(byKey("clients.scope"), "director"), "all");
    assert.equal(presetLevel(byKey("finance.vat"), "director"), "write");
  });

  test("мастер — стартовые положения, компания закрыта", () => {
    assert.equal(presetLevel(byKey("record.status"), "master"), "read");
    assert.equal(presetLevel(byKey("calendar.events"), "master"), "read");
    assert.equal(presetLevel(byKey("calendar.create"), "master"), "off");
    assert.equal(presetLevel(byKey("record.team"), "master"), "read");
    assert.equal(presetLevel(byKey("clients"), "master"), "off");
  });

  test("старший — записи целиком, деньги смотрит, клиенты свои с телефонами", () => {
    assert.equal(presetLevel(byKey("calendar.create"), "senior"), "write");
    assert.equal(presetLevel(byKey("record.status"), "senior"), "write");
    assert.equal(presetLevel(byKey("finance.operations"), "senior"), "read");
    assert.equal(presetLevel(byKey("finance.vat"), "senior"), "off");
    assert.equal(presetLevel(byKey("clients"), "senior"), "read");
    assert.equal(presetLevel(byKey("clients.scope"), "senior"), "own");
    assert.equal(presetLevel(byKey("clients.contacts"), "senior"), "read");
  });

  test("изменения: календарные — в каждом календаре; неживые и «только владелец» не трогаются", () => {
    const changes = presetChanges(REGISTRY, "director", ["A", "B"]);
    assert.ok(!changes.some((c) => c.block === "calendar.records"), "засеянный календарь не гасится");
    assert.ok(!changes.some((c) => c.block === "owner.billing"));
    assert.deepEqual(
      changes.filter((c) => c.block === "calendar.create"),
      [
        { block: "calendar.create", team_id: "A", level: "write" },
        { block: "calendar.create", team_id: "B", level: "write" },
      ],
    );
    assert.deepEqual(changes.filter((c) => c.block === "clients.scope"), [
      { block: "clients.scope", team_id: null, level: "all" },
    ]);
  });

  test("черновик после набора узнаёт свой набор; правка строки — «свой набор»", () => {
    for (const { key } of PRESETS) {
      const draft = presetDraft(blankMasterDraft("A"), REGISTRY, key);
      assert.equal(matchedPreset(REGISTRY, visibleLevel(REGISTRY, draft), draft.teamIds), key, key);
    }
    const director = presetDraft(blankMasterDraft("A"), REGISTRY, "director");
    const tweaked = { ...director, companyLevels: { ...director.companyLevels, clients: "read" as const } };
    assert.equal(matchedPreset(REGISTRY, visibleLevel(REGISTRY, tweaked), tweaked.teamIds), null);
  });

  test("умолчание в черновике не хранится — как «нет строки» на сервере", () => {
    const draft = presetDraft(blankMasterDraft("A"), REGISTRY, "master");
    assert.equal(draft.companyLevels.clients, undefined);
    assert.equal(draft.calendarLevels.A["calendar.create"], undefined);
    assert.equal(draft.calendarLevels.A["record.status"], "read");
  });

  test("строка календаря директора — «меняет», хотя у «Услуг» потолок «Видит»", () => {
    const director = presetDraft(blankMasterDraft("A"), REGISTRY, "director");
    assert.equal(calendarRightsLine(REGISTRY, director, "A"), "Записи: меняет · Деньги: меняет");
    const senior = presetDraft(blankMasterDraft("A"), REGISTRY, "senior");
    assert.equal(calendarRightsLine(REGISTRY, senior, "A"), "Записи: меняет · Деньги: видит");
  });

  test("«Отменить» после набора возвращает ровно прежние положения", () => {
    const before: MemberAccessMap = {
      tenantId: "t",
      isOwner: false,
      version: 1,
      company: { clients: "write", "clients.contacts": "read" },
      calendars: { A: { "calendar.create": "write", "record.status": "write", "finance.operations": "write" } },
      attachedCalendars: ["A"],
    };
    const read = (map: MemberAccessMap) => (b: AccessBlock, team: string | null) => levelOf(b, map, team ?? "");
    const undo = snapshotChanges(REGISTRY, read(before), ["A"]);
    const director = withMemberChanges(before, REGISTRY, presetChanges(REGISTRY, "director", ["A"]));
    assert.equal(matchedPreset(REGISTRY, read(director), ["A"]), "director");
    const back = withMemberChanges(director, REGISTRY, undo);
    for (const b of REGISTRY.filter((x) => x.live && !x.ownerOnly)) {
      const team = b.scope === "calendar" ? "A" : null;
      assert.equal(read(back)(b, team), read(before)(b, team), b.key);
    }
  });
});
