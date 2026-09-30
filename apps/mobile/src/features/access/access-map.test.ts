import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  accessChange,
  levelOf,
  parseAccessBlocks,
  parseMemberAccessMap,
  refusalOf,
  sectionsFor,
  type AccessBlock,
} from "./access-map";

// Разбор ответа сервера и правило «какое положение у блока» — по «Контракту
// v1.1» (`docs/PLAN-ACCESS-BLOCKS-2026-09-14.md`). Экран прав рисует ровно то,
// что вернули эти функции, поэтому ошибка здесь — неправда о правах человека.

const TEAM = "team-mrnz51gs-sd9bo";
const OTHER_TEAM = "team-mp8379ea-i8ith";

const row = (over: Record<string, unknown>) => ({
  key: "calendar.records",
  area: "calendar",
  scope: "calendar",
  levels: ["off", "read", "write"],
  title_ru: "Календарь и записи",
  owner_only: false,
  live: false,
  position: 10,
  ...over,
});

const blocks: AccessBlock[] = parseAccessBlocks([
  row({ key: "finance.operations", area: "finance", title_ru: "Доходы и расходы", position: 110 }),
  row({}),
  row({ key: "calendar.create", levels: ["off", "write"], title_ru: "Новые записи", position: 20 }),
  row({ key: "calendar.settings", scope: "company", title_ru: "Настройки календаря", position: 70 }),
  row({ key: "clients.scope", area: "clients", scope: "company", levels: ["own", "all"], title_ru: "Какие клиенты", position: 220 }),
  row({ key: "owner.access", area: "owner", scope: "company", levels: ["off"], owner_only: true, title_ru: "Приглашать сотрудников", position: 410 }),
]);

const byKey = (key: string): AccessBlock => {
  const found = blocks.find((b) => b.key === key);
  assert.ok(found, key);
  return found;
};

const map = parseMemberAccessMap({
  tenant_id: "11365a87-bef9-4f6c-a030-b15083fe646b",
  is_owner: false,
  version: 7,
  company: { "calendar.settings": "read" },
  calendars: { [TEAM]: { "calendar.records": "write" } },
  attached_calendars: [TEAM],
});

describe("реестр блоков", () => {
  test("идёт по position, а не по порядку строк ответа", () => {
    assert.deepEqual(
      blocks.map((b) => b.key),
      ["calendar.records", "calendar.create", "calendar.settings", "finance.operations", "clients.scope", "owner.access"],
    );
  });

  test("незнакомое положение — ошибка, а не молчаливый пропуск блока", () => {
    assert.throws(() => parseAccessBlocks([row({ levels: ["off", "maybe"] })]));
    assert.throws(() => parseAccessBlocks([row({ area: "billing" })]));
  });
});

describe("положение блока у сотрудника", () => {
  test("календарный блок читается по календарю, из которого открыли человека", () => {
    assert.equal(levelOf(byKey("calendar.records"), map, TEAM), "write");
    assert.equal(levelOf(byKey("calendar.records"), map, OTHER_TEAM), "off");
  });

  test("нет строки — первое из levels", () => {
    assert.equal(levelOf(byKey("calendar.create"), map, TEAM), "off");
    assert.equal(levelOf(byKey("clients.scope"), map, TEAM), "own");
  });

  test("блок компании не зависит от календаря", () => {
    assert.equal(levelOf(byKey("calendar.settings"), map, TEAM), "read");
    assert.equal(levelOf(byKey("calendar.settings"), map, OTHER_TEAM), "read");
  });

  test("положение, которого у блока нет, не показывается", () => {
    const odd = parseMemberAccessMap({
      tenant_id: "t",
      is_owner: false,
      version: 1,
      company: {},
      calendars: { [TEAM]: { "calendar.create": "read" } },
    });
    assert.equal(levelOf(byKey("calendar.create"), odd, TEAM), "off");
  });
});

describe("разбор карты сотрудника", () => {
  test("прикреплённые календари приходят в карту", () => {
    assert.deepEqual(map.attachedCalendars, [TEAM]);
  });

  test("битый ответ — ошибка, а не пустые права", () => {
    assert.throws(() => parseMemberAccessMap(null));
    assert.throws(() => parseMemberAccessMap({ tenant_id: "t", is_owner: false, version: 1, calendars: [] }));
    assert.throws(() =>
      parseMemberAccessMap({ tenant_id: "t", is_owner: false, version: 1, calendars: { [TEAM]: { x: "maybe" } } }),
    );
  });
});

describe("разделы экрана и изменения", () => {
  test("блоки «только владелец» на экране не появляются", () => {
    const sections = sectionsFor(blocks);
    assert.deepEqual(
      sections.map((s) => s.area),
      ["calendar", "finance", "clients"],
    );
    assert.ok(!sections.some((s) => s.blocks.some((b) => b.ownerOnly)));
  });

  test("у блока компании team_id пустой, у календарного — календарь", () => {
    assert.deepEqual(accessChange(byKey("calendar.records"), TEAM, "read"), {
      block: "calendar.records",
      team_id: TEAM,
      level: "read",
    });
    assert.equal(accessChange(byKey("calendar.settings"), TEAM, "write").team_id, null);
  });

  test("отказ сервера узнаётся по hint контракта", () => {
    assert.equal(refusalOf({ hint: "access:not_live" }), "not_live");
    assert.equal(refusalOf({ hint: "access:not_attached" }), "not_attached");
    assert.equal(refusalOf({ hint: "block:calendar.records" }), "other");
    assert.equal(refusalOf(null), "other");
  });
});
