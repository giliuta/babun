import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_HISTORY_FILTER,
  allChanges,
  changeKind,
  filterChanges,
  fullWhen,
  historyFacetCounts,
  periodRange,
  changeSubject,
  changeTarget,
  changeTitle,
  changesSummary,
  collapseBursts,
  describeField,
  type ChangeLogRow,
} from "./change-log";

// «История изменений» (владелец 03.10): строка журнала словами — что, с чем,
// что поменялось; пачки склеиваются, пара — нет.

let seq = 0;
const row = (over: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: ++seq,
  team_id: "team-1",
  actor_id: "u1",
  actor_name: "Артём",
  entity: "appointments",
  entity_id: "a1",
  action: "update",
  label: "Анастасия",
  meta: { kind: "work", date: "2026-10-04", time: "10:00" },
  changes: null,
  created_at: "2026-10-03T12:00:00Z",
  ...over,
});

describe("история изменений — слова", () => {
  test("заголовок: род предмета и действие", () => {
    assert.equal(changeTitle(row({ action: "update" })), "Запись изменена");
    assert.equal(changeTitle(row({ action: "insert", meta: { kind: "event" } })), "Событие создано");
    assert.equal(changeTitle(row({ entity: "clients", action: "delete" })), "Клиент удалён");
    assert.equal(changeTitle(row({ entity: "clients", action: "restore" })), "Клиент возвращён");
    assert.equal(changeTitle(row({ entity: "finance_transactions", action: "insert", meta: { type: "expense" } })), "Расход создан");
    assert.equal(changeTitle(row({ entity: "member_access", action: "insert" })), "Права изменены");
    assert.equal(changeTitle(row({ entity: "tenant_members", action: "insert" })), "Партнёр добавлен");
    assert.equal(changeTitle(row({ entity: "invitations", action: "update", changes: { accepted_at: [null, "x"] } })), "Приглашение принято");
    assert.equal(changeTitle(row({ entity: "team_design", action: "update" })), "Настройки записей изменены");
  });

  test("вторая строка: имя предмета, дата и время записи, сумма", () => {
    assert.equal(changeSubject(row({})), "Анастасия · 4 окт, 10:00");
    const tx = changeSubject(row({ entity: "finance_transactions", label: "Топливо", meta: { type: "expense", amount: 40 } }));
    assert.match(tx, /^Топливо · .*40/);
  });

  test("поля правки: было → стало, служебное — словом", () => {
    assert.equal(describeField("time_start", ["09:30", "10:00"]), "Начало 09:30 → 10:00");
    assert.equal(describeField("status", ["scheduled", "cancelled"]), "Статус запланирована → отменена");
    assert.equal(describeField("client_id", ["a", "b"]), "Клиент");
    assert.equal(describeField("services", "*"), "Услуги");
    assert.equal(describeField("blacklisted", [false, true]), "Чёрный список нет → да");
    assert.equal(describeField("mystery_column", [1, 2]), null);
  });

  test("сводка правки: до трёх полей и «ещё N», дубли слов схлопнуты", () => {
    assert.equal(
      changesSummary({ time_start: ["09:30", "10:00"], time_end: ["10:30", "11:00"], services: "*", comment: ["", "x"], foo: [1, 2] }),
      "Начало 09:30 → 10:00 · Конец 10:30 → 11:00 · Услуги · ещё 2",
    );
    assert.equal(changesSummary({ calendar_window_start: ["08:00", "07:00"], calendar_window_end: ["20:00", "21:00"] }), "Часы календаря 08:00 → 07:00");
    assert.equal(changesSummary({ foo: [1, 2] }), "Служебные поля");
    // Живая строка 03.10: предоплата — список и сумма, видна сумма.
    const prepaid = changesSummary({ prepayments: "*", payment_method: [null, "cash"], payment_status: ["unpaid", "paid"], prepaid_amount: [0, 50], payment_account_id: [null, "x"] });
    assert.match(prepaid, /^Предоплата .*0 → .*50 · Способ оплаты — → наличные · Оплата не оплачена → оплачена · ещё 1$/);
    assert.equal(changesSummary(null), "");
  });

  test("тап: запись и клиент открываются, удалённое — нет", () => {
    assert.deepEqual(changeTarget(row({})), { kind: "appointment", id: "a1" });
    assert.deepEqual(changeTarget(row({ entity: "clients", entity_id: "c1" })), { kind: "client", id: "c1" });
    assert.equal(changeTarget(row({ action: "delete" })), null);
    assert.equal(changeTarget(row({ entity: "teams" })), null);
  });
});

describe("история изменений — пачки", () => {
  test("импорт клиентов — одна строка ×N", () => {
    const rows = [0, 1, 2, 3].map((i) =>
      row({ entity: "clients", action: "insert", label: `Клиент ${i}`, created_at: `2026-10-03T12:00:0${i}Z` }),
    );
    const items = collapseBursts(rows);
    assert.equal(items.length, 1);
    assert.equal(items[0].count, 4);
    assert.deepEqual(items[0].labels, ["Клиент 0", "Клиент 1", "Клиент 2", "Клиент 3"]);
  });

  test("две записи подряд руками — две строки", () => {
    const items = collapseBursts([
      row({ action: "insert", label: "А" }),
      row({ action: "insert", label: "Б" }),
    ]);
    assert.equal(items.length, 2);
  });

  test("правки не склеиваются, права одного человека — склеиваются", () => {
    assert.equal(collapseBursts([row({}), row({}), row({})]).length, 3);
    const rights = collapseBursts([
      row({ entity: "member_access", action: "insert", label: "Иван" }),
      row({ entity: "member_access", action: "insert", label: "Иван" }),
      row({ entity: "member_access", action: "insert", label: "Олег" }),
    ]);
    assert.deepEqual(rights.map((i) => [i.row.label, i.count]), [["Иван", 2], ["Олег", 1]]);
  });

  test("разные авторы и разрыв больше трёх минут — не пачка", () => {
    const a = row({ entity: "clients", action: "insert", created_at: "2026-10-03T12:00:00Z" });
    const b = row({ entity: "clients", action: "insert", actor_id: "u2", created_at: "2026-10-03T12:00:01Z" });
    const c = row({ entity: "clients", action: "insert", actor_id: "u2", created_at: "2026-10-03T11:50:00Z" });
    assert.equal(collapseBursts([a, b, c]).length, 3);
  });

  test("разные команды и разные предметы одной таблицы — не пачка", () => {
    const work = row({ entity: "clients", action: "insert", label: "А" });
    const other = row({ entity: "clients", action: "insert", label: "Б", team_id: "team-2" });
    assert.equal(collapseBursts([work, other]).length, 2);
    const income = row({ entity: "finance_transactions", action: "delete", meta: { type: "income" } });
    const expense = row({ entity: "finance_transactions", action: "delete", meta: { type: "expense" } });
    assert.equal(collapseBursts([income, expense]).length, 2);
  });
});

describe("история изменений — списки и подробности", () => {
  test("заметка, телефоны, оплаты: что добавили и что убрали", () => {
    assert.equal(describeField("notes", { "+": ["ключ под ковриком"] }), "Заметка + «ключ под ковриком»");
    assert.equal(describeField("notes", { "-": ["Zaikaitsa"] }), "Заметка − «Zaikaitsa»");
    assert.equal(describeField("phones", { "+": ["+35799000000"] }), "Телефоны + +35799000000");
    assert.match(describeField("payments", { "+": ["50"] }) ?? "", /^Оплата \+ .*50/);
    // Без имён — просто слово поля.
    assert.equal(describeField("services", "*"), "Услуги");
  });

  test("подробности — все поля, служебные одной строкой", () => {
    const lines = allChanges({
      time_start: ["09:30", "10:00"],
      notes: { "+": ["новая"], "-": ["старая"] },
      weird_column: [1, 2],
      another: [3, 4],
    });
    assert.deepEqual(lines, ["Начало 09:30 → 10:00", "Заметка + «новая» · − «старая»", "Служебные поля: 2"]);
  });

  test("точное время до секунды", () => {
    const iso = new Date(2026, 9, 3, 18, 49, 6).toISOString();
    assert.equal(fullWhen(iso), "3 октября 2026, 18:49:06");
  });
});

describe("история изменений — фильтры", () => {
  const rows = [
    row({ actor_id: "me", entity: "appointments", action: "insert", team_id: "t1" }),
    row({ actor_id: "ivan", entity: "appointments", action: "update", team_id: "t1" }),
    row({ actor_id: "ivan", entity: "clients", action: "delete", team_id: "t2" }),
    row({ actor_id: null, entity: "finance_transactions", action: "insert", team_id: "t1", meta: { type: "income" } }),
    row({ actor_id: "me", entity: "member_access", action: "insert", team_id: null }),
  ];

  test("виды: записи, события, клиенты, деньги, права, настройки", () => {
    assert.equal(changeKind(row({})), "records");
    assert.equal(changeKind(row({ meta: { kind: "event" } })), "events");
    assert.equal(changeKind(row({ entity: "clients" })), "clients");
    assert.equal(changeKind(row({ entity: "debts" })), "money");
    assert.equal(changeKind(row({ entity: "member_calendars" })), "people");
    assert.equal(changeKind(row({ entity: "services" })), "settings");
  });

  test("фильтр по человеку, команде, виду и действию — И между фасетами, ИЛИ внутри", () => {
    assert.equal(filterChanges(rows, EMPTY_HISTORY_FILTER).length, 5);
    assert.equal(filterChanges(rows, { ...EMPTY_HISTORY_FILTER, actors: ["ivan"] }).length, 2);
    assert.equal(filterChanges(rows, { ...EMPTY_HISTORY_FILTER, actors: ["system"] }).length, 1);
    assert.equal(filterChanges(rows, { ...EMPTY_HISTORY_FILTER, teams: ["none"] }).length, 1);
    assert.equal(filterChanges(rows, { ...EMPTY_HISTORY_FILTER, actors: ["ivan", "me"], kinds: ["records"] }).length, 2);
    assert.equal(filterChanges(rows, { ...EMPTY_HISTORY_FILTER, actions: ["delete"] }).length, 1);
  });

  test("счётчики фасета не гасят соседей своим же выбором", () => {
    const counts = historyFacetCounts(rows, { ...EMPTY_HISTORY_FILTER, actors: ["ivan"] });
    // «Кто» считается без своего фильтра — видно всех.
    assert.deepEqual(counts.actors, { me: 2, ivan: 2, system: 1 });
    // Остальные — только по Ивану.
    assert.deepEqual(counts.kinds, { records: 1, clients: 1 });
  });

  test("период: сегодня, вчера, всё время", () => {
    const now = new Date(2026, 9, 3, 15, 0, 0);
    const today = periodRange("today", now);
    assert.equal(new Date(today.from as string).getHours(), 0);
    assert.equal(today.to, null);
    const yesterday = periodRange("yesterday", now);
    assert.equal(new Date(yesterday.from as string).getDate(), 2);
    assert.equal(yesterday.to, today.from);
    assert.deepEqual(periodRange("all", now), { from: null, to: null });
  });

  test("период — календарными днями, а не по 24 часа (переход времени 25.10)", () => {
    const now = new Date(2026, 9, 26, 10, 0, 0);
    const week = new Date(periodRange("week", now).from as string);
    assert.deepEqual([week.getDate(), week.getHours(), week.getMinutes()], [20, 0, 0]);
    const yesterday = new Date(periodRange("yesterday", now).from as string);
    assert.deepEqual([yesterday.getDate(), yesterday.getHours()], [25, 0]);
  });

  test("новые предметы журнала: вид, заголовок и дверь", () => {
    const tag = row({ entity: "client_tag_assignments", action: "insert", entity_id: "c1", label: "Артем", meta: { tag: "VIP" } });
    assert.equal(changeKind(tag), "clients");
    assert.equal(changeTitle(tag), "Тег поставлен");
    assert.deepEqual(changeTarget(tag), { kind: "client", id: "c1" });
    const photo = row({ entity: "appointment_photos", action: "insert", entity_id: "a9" });
    assert.equal(changeKind(photo), "records");
    assert.deepEqual(changeTarget(photo), { kind: "appointment", id: "a9" });
    assert.equal(changeKind(row({ entity: "masters" })), "people");
    assert.equal(changeKind(row({ entity: "day_cities" })), "settings");
  });

  test("значения словами: уровень права и статус инвойса", () => {
    assert.equal(describeField("level", ["read", "write"]), "Уровень только видит → видит и меняет");
    const status = describeField("status", ["issued", "paid"]) ?? "";
    assert.match(status, /→/);
    assert.doesNotMatch(status, /issued|paid/);
  });
});
