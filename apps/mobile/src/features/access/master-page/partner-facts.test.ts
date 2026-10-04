import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { monthSumLine, payoutsByMonth, payoutsOfMonth, seenLine, teamMoneyOf } from "./partner-facts";

// Факты страницы партнёра (04.10): «был в приложении», деньги его команд,
// выплаты ему.

const NOW = new Date(2026, 9, 4, 15, 0); // 4 октября 2026, 15:00 по телефону

describe("был в приложении", () => {
  test("сегодня и вчера — со временем, раньше — датой", () => {
    assert.equal(seenLine(new Date(2026, 9, 4, 13, 40).toISOString(), NOW), "сегодня, 13:40");
    assert.equal(seenLine(new Date(2026, 9, 3, 9, 5).toISOString(), NOW), "вчера, 09:05");
    assert.equal(seenLine(new Date(2026, 9, 1, 9, 5).toISOString(), NOW), "1 окт");
    assert.equal(seenLine(new Date(2025, 11, 30, 9, 5).toISOString(), NOW), "30 дек ’25");
  });
  test("входа не было — так и сказано", () => {
    assert.equal(seenLine(null, NOW), "входа не было");
    assert.equal(seenLine("не дата", NOW), "входа не было");
  });
});

describe("деньги его команд", () => {
  const rows = [
    { date: "2026-10-02", team_id: "a", paid: 100, debt: 20 },
    { date: "2026-10-03", team_id: "a", paid: 50, debt: 0, status: "cancelled" },
    { date: "2026-10-03", team_id: "a", paid: 70, debt: 0, kind: "event" },
    { date: "2026-10-04", team_id: "b", paid: 30, debt: 0 },
    { date: "2026-10-09", team_id: "a", paid: 40, debt: 60 },
    { date: "2026-09-20", team_id: "a", paid: 500, debt: 15.5 },
    { date: "2026-10-02", team_id: "чужая", paid: 999, debt: 999 },
  ];
  test("получено — за месяц; долги — по прошедшим за всё время", () => {
    const money = teamMoneyOf(rows, ["a", "b"], NOW, (r) => r.paid, (r) => r.debt);
    // 100 + 30 + 40 (будущая запись месяца уже с авансом) — без отменённой,
    // события и чужой команды.
    assert.equal(money.received, 170);
    // 20 + 15.5: будущая запись ещё не долг.
    assert.equal(money.debt, 35.5);
  });
});

describe("выплаты ему", () => {
  const rows = [
    { type: "expense", amount: "15", occurred_on: "2026-10-04", created_at: "2026-10-04T10:00:00Z" },
    { type: "expense", amount: -20, occurred_on: null, created_at: "2026-10-01T10:00:00Z" },
    { type: "expense", amount: 40, occurred_on: "2026-09-30", created_at: "2026-10-01T10:00:00Z" },
    { type: "income", amount: 99, occurred_on: "2026-10-04", created_at: "2026-10-04T10:00:00Z" },
  ];
  test("за месяц — расходы с ним в «Кому», по дню операции", () => {
    assert.equal(payoutsOfMonth(rows, NOW), 35);
  });
  test("строка месяца — сумма или «нет»", () => {
    assert.equal(monthSumLine(35, "€35", NOW), "€35 в октябре");
    assert.equal(monthSumLine(0, "€0", NOW), "в октябре нет");
  });
  test("по месяцам — свежие сверху, с итогом", () => {
    const months = payoutsByMonth(rows);
    assert.deepEqual(
      months.map((m) => [m.month, m.total, m.rows.length]),
      [
        ["2026-10", 35, 2],
        ["2026-09", 40, 1],
      ],
    );
    assert.equal(months[0].rows[0].occurred_on, "2026-10-04");
  });
});
