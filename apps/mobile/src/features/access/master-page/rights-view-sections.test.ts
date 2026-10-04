import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { dependantResets } from "./master-draft";
import { sectionBrief, viewSections } from "./rights-view-sections";

// СТРАНИЦЫ РАЗДЕЛОВ ДОСТУПА — БЛОКАМИ (владелец 30.09). Право стоит там, куда
// его поставил владелец, и только там: «Доход» и «Расход» с 03.10 — в
// «Главном» «Финансов» по плиткам страницы, а не в «Календаре».

const block = (key: string, levels: AccessLevel[], position: number): AccessBlock => ({
  key,
  area: key.startsWith("finance") ? "finance" : key.startsWith("clients") ? "clients" : "calendar",
  scope: "calendar",
  levels,
  title: key,
  ownerOnly: false,
  live: true,
  position,
});

const REGISTRY: AccessBlock[] = [
  block("calendar.records", ["off", "read", "write"], 10),
  block("calendar.create", ["off", "write"], 20),
  block("calendar.events", ["off", "read", "write"], 25),
  block("calendar.move", ["off", "write"], 26),
  block("calendar.cancel", ["off", "write"], 28),
  block("record.color", ["off", "write"], 37),
  block("record.team", ["read", "write"], 31),
  block("record.note", ["off", "read", "write"], 38),
  block("event.label", ["off", "read", "write"], 61),
  block("record.label", ["off", "read", "write"], 32),
  block("event.type", ["off", "read", "write"], 64),
  block("calendar.day_labels", ["off", "read", "write"], 60),
  block("calendar.schedule", ["off", "read", "write"], 75),
  block("calendar.identity", ["off", "read", "write"], 76),
  block("calendar.booking_form", ["off", "read", "write"], 79),
  block("calendar.services", ["off", "read", "write"], 80),
  block("calendar.labels", ["off", "read", "write"], 81),
  block("finance.income", ["off", "read", "write", "full"], 108),
  block("finance.expense", ["off", "read", "write", "full"], 109),
  block("finance.accounts", ["off", "read", "write"], 120),
  block("finance.debts", ["off", "read", "write"], 130),
  block("finance.documents", ["off", "read", "write"], 140),
  block("finance.profit", ["off", "read"], 150),
  // «Реквизиты» — право аккаунта (как в базе): на странице команды его нет.
  { ...block("finance.settings_requisites", ["off", "read"], 165), scope: "company" },
  block("finance.settings_accounts", ["off", "read", "write"], 160),
  block("finance.settings_trash", ["off", "read", "write"], 161),
  block("finance.settings_categories_income", ["off", "read", "write"], 162),
  block("finance.settings_categories_expense", ["off", "read", "write"], 163),
  block("finance.settings_categories_debts", ["off", "read", "write"], 164),
];

const page = (group: "calendar" | "finance" | "record", open: Record<string, AccessLevel> = {}) =>
  viewSections({
    blocks: REGISTRY,
    levelOf: (b) => open[b.key] ?? (b.key === "calendar.records" ? "read" : (b.levels[0] as AccessLevel)),
    activeId: "team-1",
    onlyCalendar: true,
    onlyCompany: false,
    group,
  }).map((section) => ({
    title: section.title,
    // Живые строки — серые (главный блок скрыт) отдельно не считаются.
    keys: section.rows.filter((row) => !row.foldedBy).map((row) => row.block.key),
  })).filter((section) => section.keys.length > 0);

describe("страница раздела доступа — блоками владельца", () => {
  test("«Календарь»: «Главное» одним блоком с записями (03.10), «Настройки команды» — строками шестерёнки", () => {
    assert.deepEqual(page("calendar"), [
      // «Записи» влиты в «Главное» (владелец 03.10).
      { title: "Главное", keys: ["calendar.day_labels", "calendar.records", "calendar.events", "calendar.move", "calendar.cancel"] },
      // Блоки внутри записи — здесь же (владелец 30.09); события скрыты —
      // блока «Событие» нет.
      { title: "Запись клиента", keys: ["record.team", "record.when", "record.note"] },
      {
        title: "Настройки команды",
        keys: [
          "calendar.identity",
          "calendar.schedule",
          "calendar.booking_form",
          "calendar.services",
          "calendar.labels",
        ],
      },
    ]);
  });

  test("«Записи событий» открыты — блок «Событие» встаёт под «Записью клиента»", () => {
    const titles = page("calendar", { "calendar.events": "read" }).map((section) => section.title);
    assert.deepEqual(titles.slice(0, 3), ["Главное", "Запись клиента", "Событие"]);
  });

  test("отдельного раздела «Запись» больше нет — его блоки в «Календаре»", () => {
    assert.deepEqual(page("record"), []);
  });

  test("«Метка дня: Скрыта» — метки записи и события серые, открыта — живые", () => {
    const rows = (open: Record<string, AccessLevel>) =>
      viewSections({
        blocks: REGISTRY,
        levelOf: (b) => open[b.key] ?? (b.levels[0] as AccessLevel),
        activeId: "team-1",
        onlyCalendar: true,
        onlyCompany: false,
        group: "calendar",
      }).flatMap((section) => section.rows);
    const base = { "calendar.records": "read", "calendar.events": "read", "record.label": "read", "event.label": "read" } as const;
    const hidden = rows({ ...base, "calendar.day_labels": "off" });
    assert.equal(hidden.find((r) => r.block.key === "record.label")?.foldedBy, "calendar.day_labels");
    assert.equal(hidden.find((r) => r.block.key === "event.label")?.foldedBy, "calendar.day_labels");
    const open = rows({ ...base, "calendar.day_labels": "read" });
    assert.equal(open.find((r) => r.block.key === "record.label")?.foldedBy, undefined);
  });

  test("скрыли «Метку дня» — метка записи не стирается, откроют — вернётся", () => {
    const day = REGISTRY.find((b) => b.key === "calendar.day_labels")!;
    assert.deepEqual(dependantResets(REGISTRY, day, "off", "team-1"), []);
    // А «Записи клиентов» свои блоки по-прежнему сбрасывают.
    const records = REGISTRY.find((b) => b.key === "calendar.records")!;
    assert.ok(dependantResets(REGISTRY, records, "off", "team-1").some((c) => c.block === "record.label"));
  });

  test("«Финансы»: «Главное» — плитки страницы по порядку, «Настройки финансов» — строки шестерёнки (03.10)", () => {
    assert.deepEqual(page("finance"), [
      {
        title: "Главное",
        keys: [
          "finance.accounts",
          "finance.documents",
          "finance.income",
          "finance.expense",
          "finance.debts",
          "finance.profit",
        ],
      },
      // Блоки шестерёнки «Финансов» — её названиями и в её порядке (03.10).
      { title: "Деньги", keys: ["finance.settings_accounts", "finance.settings_trash"] },
      {
        title: "Категории",
        keys: [
          "finance.settings_categories_income",
          "finance.settings_categories_expense",
          "finance.settings_categories_debts",
        ],
      },
      // «Реквизиты» с 04.10 — в разделе «Кабинет», не в шестерёнке.
    ]);
  });

  test("право шестерёнки на весь аккаунт — в «Настройках финансов» команды; «Реквизиты» — в «Кабинете» (04.10)", () => {
    const company = (key: string, position: number): AccessBlock => ({
      ...block(key, ["off", "read"], position),
      scope: "company",
    });
    const blocks = [
      ...REGISTRY.filter((b) => b.key !== "finance.settings_requisites"),
      company("finance.settings_requisites", 165),
      company("finance.settings_currency", 166),
      { ...block("company.services", ["off", "read"], 200), area: "company", scope: "company" } as AccessBlock,
    ];
    const levelOf = (b: AccessBlock, teamId: string | null) =>
      b.scope === "company" ? (teamId === null ? "read" : "off") : (b.levels[0] as AccessLevel);
    const finance = viewSections({
      blocks,
      levelOf,
      activeId: "team-1",
      onlyCalendar: true,
      onlyCompany: false,
      group: "finance",
    });
    assert.deepEqual(
      finance
        .filter((section) => section.title !== "Главное")
        .map((section) => [section.title, section.rows.map((row) => [row.block.key, row.level])]),
      [
        ["Деньги", [["finance.settings_accounts", "off"], ["finance.settings_trash", "off"]]],
        [
          "Категории",
          [
            ["finance.settings_categories_income", "off"],
            ["finance.settings_categories_expense", "off"],
            ["finance.settings_categories_debts", "off"],
          ],
        ],
        // Положение аккаунта — без команды, а не «закрыто» в команде.
        ["Общие", [["finance.settings_currency", "read"]]],
      ],
    );
    const card = viewSections({
      blocks,
      levelOf,
      activeId: "team-1",
      onlyCalendar: true,
      onlyCompany: false,
      withCompany: true,
    }).find((section) => section.key === "company");
    // «Кабинет»: строки Кабинета по порядку, прочее — после них.
    assert.equal(card?.title, "Кабинет");
    assert.deepEqual(card?.rows.map((row) => row.block.key), ["finance.settings_requisites", "company.services"]);
    // Страница «Кабинета» — одной карточкой, вместе с «Реквизитами» из финансов.
    const cabinet = viewSections({ blocks, levelOf, activeId: "team-1", onlyCalendar: false, onlyCompany: true, area: "company" });
    assert.deepEqual(
      cabinet.map((section) => [section.title, section.rows.map((row) => row.block.key)]),
      [["", ["finance.settings_requisites", "company.services"]]],
    );
  });

  test("«Кабинет» — тариф, оплаты, SMS, реквизиты в порядке строк Кабинета (04.10)", () => {
    const account = (key: string, area: AccessBlock["area"], position: number, levels: AccessLevel[]): AccessBlock => ({
      ...block(key, levels, position),
      area,
      scope: "company",
    });
    const blocks = [
      account("finance.settings_requisites", "finance", 156, ["off", "read"]),
      account("cabinet.sms", "company", 373, ["off", "read", "write"]),
      account("cabinet.tariff", "company", 371, ["off", "read", "write"]),
      account("cabinet.tariff_payments", "company", 372, ["off", "read"]),
    ];
    const sections = viewSections({
      blocks,
      levelOf: () => "read",
      activeId: null,
      onlyCalendar: false,
      onlyCompany: true,
    });
    assert.deepEqual(sections.map((section) => section.rows.map((row) => row.block.key)), [
      ["cabinet.tariff", "cabinet.tariff_payments", "cabinet.sms", "finance.settings_requisites"],
    ]);
  });
});

describe("подпись раздела в «Доступе»", () => {
  test("аббревиатура не строчится: «Тариф, SMS», а не «Тариф, sMS» (04.10)", () => {
    const rows = [
      { block: block("cabinet.tariff", ["off", "read", "write"], 371), level: "read" },
      { block: block("cabinet.sms", ["off", "read", "write"], 373), level: "write" },
      { block: block("finance.settings_requisites", ["off", "read"], 156), level: "read" },
      { block: block("cabinet.history", ["off", "read"], 374), level: "off" },
    ];
    assert.equal(
      sectionBrief({ rows } as unknown as Parameters<typeof sectionBrief>[0]),
      "Тариф, SMS, реквизиты",
    );
  });
  test("длинный список — два имени и число (04.10)", () => {
    const rows = ["a", "b", "c", "d", "e"].map((key, i) => ({
      block: block(`calendar.${key}`, ["off", "read"], 10 + i),
      level: "read",
    }));
    const brief = sectionBrief({ rows: [...rows, { ...rows[0], level: "off" }] } as unknown as Parameters<typeof sectionBrief>[0]);
    assert.match(brief, / и ещё 3$/);
    assert.equal(brief.split(", ").length, 2);
  });
});
