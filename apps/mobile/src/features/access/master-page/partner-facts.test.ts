import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { monthReceived, seenLine } from "./partner-facts";

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

describe("выручка его команд", () => {
  const rows = [
    { date: "2026-10-02", team_id: "a", paid: 100 },
    { date: "2026-10-03", team_id: "a", paid: 50, status: "cancelled" },
    { date: "2026-10-03", team_id: "a", paid: 70, kind: "event" },
    { date: "2026-10-04", team_id: "b", paid: 30 },
    { date: "2026-10-09", team_id: "a", paid: 40 },
    { date: "2026-09-20", team_id: "a", paid: 500 },
    { date: "2026-10-02", team_id: "чужая", paid: 999 },
  ];
  test("за месяц — без отменённых, событий и чужих команд", () => {
    // 100 + 30 + 40 (будущая запись месяца уже с авансом).
    assert.equal(monthReceived(rows, ["a", "b"], NOW, (r) => r.paid), 170);
  });
});
