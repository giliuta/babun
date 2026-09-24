import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel, MemberAccessMap } from "../access-map";
import { areaWord, draftLevel, emptyMasterDraft, toggleTeam, withLevel } from "./master-draft";
import {
  draftFromMemberAccess,
  levelChanges,
  rightsSections,
  withMemberChanges,
} from "./rights-rows";

// Реестр — копия строк `access_blocks` (миграция 20260914140000), как в
// тесте черновика: свёртка проверяется на настоящих ключах.
//
// ЖИВОСТЬ ЗДЕСЬ ВКЛЮЧЕНА У ВСЕХ (STORY-083): страница с 20.09 предлагает
// только те блоки, которые сервер правда проверяет (`offeredBlocks`), а этот
// тест про ПОРЯДОК и СВЁРТКУ строк — ему нужен полный реестр. Правило «неживое
// не показываем» проверяется отдельно, ниже и в `rights-copy.test.ts`.
const OFF_READ_WRITE: AccessLevel[] = ["off", "read", "write"];
const REGISTRY: AccessBlock[] = (
  [
    ["calendar.records", "calendar", "calendar", OFF_READ_WRITE, 10],
    ["calendar.create", "calendar", "calendar", ["off", "write"], 20],
    ["record.status", "calendar", "calendar", OFF_READ_WRITE, 30],
    ["record.amount", "calendar", "calendar", OFF_READ_WRITE, 40],
    ["record.payment", "calendar", "calendar", OFF_READ_WRITE, 50],
    ["calendar.day_labels", "calendar", "calendar", OFF_READ_WRITE, 60],
    ["calendar.settings", "calendar", "company", OFF_READ_WRITE, 70],
    ["finance.operations", "finance", "calendar", OFF_READ_WRITE, 110],
    ["finance.vat", "finance", "company", OFF_READ_WRITE, 175],
    ["clients", "clients", "company", OFF_READ_WRITE, 210],
    ["clients.scope", "clients", "company", ["own", "all"], 220],
    ["clients.contacts", "clients", "company", ["off", "read"], 230],
    ["services", "company", "company", OFF_READ_WRITE, 310],
    ["company.currency", "company", "company", ["read", "write"], 330],
    ["owner.access", "owner", "company", ["off"], 410],
  ] as const
).map(([key, area, scope, levels, position]) => ({
  key,
  area,
  scope,
  levels,
  title: key,
  ownerOnly: area === "owner",
  live: true,
  position,
}));

const block = (key: string): AccessBlock => {
  const found = REGISTRY.find((candidate) => candidate.key === key);
  if (!found) throw new Error(key);
  return found;
};

const keysOf = (sections: ReturnType<typeof rightsSections>, area: string) =>
  sections.find((section) => section.area === area)?.rows.map((row) => row.block.key) ?? [];

const CALENDAR_DEPENDANTS = [
  "calendar.create",
  "record.status",
  "record.amount",
  "record.payment",
  "calendar.day_labels",
];

// Деньги календаря в реестре теста — «Доходы и расходы»; остальные блоки
// финансов в копию реестра не входят.
const FINANCE_CALENDAR_DEPENDANTS = ["finance.operations"];

describe("страница прав — какие строки видны", () => {
  test("в разделе сначала блоки календаря, потом блоки компании", () => {
    const shuffled = REGISTRY.map((b) =>
      b.key === "finance.vat" ? { ...b, position: 100 } : b,
    ).sort((a, b) => a.position - b.position);
    const sections = rightsSections(shuffled, () => "write", "team-1");
    assert.deepEqual(keysOf(sections, "finance"), ["finance.operations", "finance.vat"]);
  });

  test("«Календарь и записи» скрыт — пять строк свёрнуты только в этом календаре", () => {
    let draft = toggleTeam(emptyMasterDraft("team-1"), "team-2");
    draft = withLevel(draft, block("calendar.records"), "read", "team-2");
    const levelOf = (b: AccessBlock, teamId: string | null) => draftLevel(b, draft, teamId);

    const hidden = keysOf(rightsSections(REGISTRY, levelOf, "team-1"), "calendar");
    const shown = keysOf(rightsSections(REGISTRY, levelOf, "team-2"), "calendar");
    for (const key of CALENDAR_DEPENDANTS) {
      assert.equal(hidden.includes(key), false, `${key} виден при скрытом главном`);
      assert.equal(shown.includes(key), true, `${key} не виден при открытом главном`);
    }
    assert.deepEqual(hidden, ["calendar.records", "calendar.settings"]);
  });

  test("«Календарь и записи» скрыт — деньги этого календаря тоже свёрнуты, VAT компании нет", () => {
    let draft = toggleTeam(emptyMasterDraft("team-1"), "team-2");
    draft = withLevel(draft, block("calendar.records"), "read", "team-2");
    const levelOf = (b: AccessBlock, teamId: string | null) => draftLevel(b, draft, teamId);
    assert.deepEqual(keysOf(rightsSections(REGISTRY, levelOf, "team-1"), "finance"), ["finance.vat"]);
    assert.deepEqual(keysOf(rightsSections(REGISTRY, levelOf, "team-2"), "finance"), [
      ...FINANCE_CALENDAR_DEPENDANTS,
      "finance.vat",
    ]);
  });

  test("«Клиенты» скрыты — «Какие клиенты» и «Телефоны» свёрнуты", () => {
    const draft = emptyMasterDraft("team-1");
    const levelOf = (b: AccessBlock, teamId: string | null) => draftLevel(b, draft, teamId);
    assert.deepEqual(keysOf(rightsSections(REGISTRY, levelOf, "team-1"), "clients"), ["clients"]);

    const open = withLevel(draft, block("clients"), "read", null);
    const openLevel = (b: AccessBlock, teamId: string | null) => draftLevel(b, open, teamId);
    assert.deepEqual(keysOf(rightsSections(REGISTRY, openLevel, "team-1"), "clients"), [
      "clients",
      "clients.scope",
      "clients.contacts",
    ]);
  });

  test("без календаря календарных строк нет, пустых разделов — тоже", () => {
    const draft = toggleTeam(emptyMasterDraft("team-1"), "team-1");
    assert.deepEqual(draft.teamIds, []);
    const levelOf = (b: AccessBlock, teamId: string | null) => draftLevel(b, draft, teamId);
    const sections = rightsSections(REGISTRY, levelOf, null);
    assert.deepEqual(keysOf(sections, "calendar"), ["calendar.settings"]);
    assert.deepEqual(keysOf(sections, "finance"), ["finance.vat"]);
    assert.equal(
      sections.some((section) => section.rows.length === 0),
      false,
      "раздел без строк",
    );
  });

  test("блоков владельца на странице нет, разделов — четыре", () => {
    const sections = rightsSections(REGISTRY, () => "write", "team-1");
    assert.deepEqual(
      sections.map((section) => section.area),
      ["calendar", "finance", "clients", "company"],
    );
    assert.equal(
      sections.some((section) => section.rows.some((row) => row.block.ownerOnly)),
      false,
    );
  });
});

describe("сотрудник на карточке мастера", () => {
  const map: MemberAccessMap = {
    tenantId: "tenant-1",
    isOwner: false,
    version: 3,
    company: { clients: "read" },
    calendars: {
      "team-1": { "calendar.records": "write" },
      "team-old": { "calendar.records": "read" },
    },
    attachedCalendars: ["team-1", "team-2"],
  };
  const identity = { name: "Dmitry", email: "d@example.com", phone: "", title: "", color: null };

  test("карта становится черновиком только из прикреплённых календарей", () => {
    const draft = draftFromMemberAccess(map, identity);
    assert.deepEqual(draft.teamIds, ["team-1", "team-2"]);
    assert.equal(draft.calendarLevels["team-old"], undefined);
    assert.equal(areaWord(REGISTRY, draft, "calendar"), "Частично");
    assert.equal(areaWord(REGISTRY, draft, "finance"), "Не видит");
  });

  test("положение уходит вместе со сбросом зависимых; календарный без календаря — никак", () => {
    const changes = levelChanges(REGISTRY, block("calendar.records"), "off", "team-1");
    assert.deepEqual(
      changes?.map((change) => `${change.block}@${change.team_id}=${change.level}`),
      [
        "calendar.records@team-1=off",
        ...CALENDAR_DEPENDANTS.map((key) => `${key}@team-1=off`),
        ...FINANCE_CALENDAR_DEPENDANTS.map((key) => `${key}@team-1=off`),
      ],
    );
    assert.equal(levelChanges(REGISTRY, block("calendar.records"), "read", null), null);
    assert.deepEqual(levelChanges(REGISTRY, block("clients"), "read", "team-1"), [
      { block: "clients", team_id: null, level: "read" },
    ]);
  });

  test("скрытие главного сбрасывает и неживые зависимые — у сотрудника их уровень хранится", () => {
    const registry = REGISTRY.map((b) => (b.key === "calendar.records" ? { ...b, live: true } : b));
    const records = registry.find((b) => b.key === "calendar.records");
    assert.ok(records);
    const changes = levelChanges(registry, records, "off", "team-1");
    assert.ok(changes);
    assert.deepEqual(changes[0], { block: "calendar.records", team_id: "team-1", level: "off" });
    assert.ok(
      changes.some((c) => c.block === "calendar.create" && c.team_id === "team-1" && c.level === "off"),
      "неживой «Новые записи» не сброшен",
    );
    assert.ok(
      changes.some((c) => c.block === "record.amount" && c.team_id === "team-1" && c.level === "off"),
      "неживой «Сумма» не сброшен",
    );
    const accepted: MemberAccessMap = {
      ...map,
      calendars: { "team-1": { "calendar.records": "write", "calendar.create": "write" } },
    };
    const next = withMemberChanges(accepted, registry, changes);
    assert.equal(next.calendars["team-1"]?.["calendar.create"], undefined);
    assert.equal(next.calendars["team-1"]?.["calendar.records"], undefined);
  });

  test("правка до ответа сервера не трогает исходную карту и не хранит умолчание", () => {
    const next = withMemberChanges(map, REGISTRY, [
      { block: "calendar.records", team_id: "team-1", level: "off" },
      { block: "finance.operations", team_id: "team-2", level: "read" },
      { block: "clients", team_id: "team-1", level: "write" },
    ]);
    assert.equal(next.calendars["team-1"]?.["calendar.records"], undefined);
    assert.equal(next.calendars["team-2"]?.["finance.operations"], "read");
    assert.equal(next.company.clients, "read", "компанейский блок с календарём пропущен");
    assert.equal(next.calendars["team-1"]?.clients, undefined, "и в календарь не лёг");
    assert.equal(map.calendars["team-1"]?.["calendar.records"], "write");
    assert.equal(map.calendars["team-2"], undefined);
  });
});

describe("страница не предлагает того, что сервер не держит", () => {
  test("неживой блок не даёт строки, даже если он первый в разделе", () => {
    const sleeping = REGISTRY.map((b) =>
      b.key === "calendar.records" || b.key === "calendar.create" ? { ...b, live: false } : b,
    );
    const sections = rightsSections(sleeping, () => "write", "team-1");
    const calendar = sections.find((section) => section.area === "calendar");
    const keys = calendar?.rows.map((row) => row.block.key) ?? [];
    assert.ok(!keys.includes("calendar.records"), "спящий блок снова предлагается");
    assert.ok(!keys.includes("calendar.create"), "спящий зависимый снова предлагается");
    // Остальные строки раздела на месте: спит не весь раздел, а блок.
    assert.ok(keys.includes("record.status"));
  });

  test("все блоки спят — разделов нет вовсе", () => {
    const asleep = REGISTRY.map((b) => ({ ...b, live: false }));
    assert.deepEqual(rightsSections(asleep, () => "write", "team-1"), []);
  });
});
