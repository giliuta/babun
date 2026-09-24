import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ПОЛОСА «ДОХОД / РАСХОД» ПОД СЕТКОЙ — ТОЛЬКО ПРИШЕДШИЕ ДЕНЬГИ (владелец
// 2026-09-24): неоплаченная запись не доход ни в прошлом, ни сегодня, ни
// завтра. Само правило «заработано» и его случаи — `day-summary.test.ts`.
describe("доход под сеткой календаря", () => {
  test("полоса берёт заработанное, а не план — в любой день", () => {
    const src = readFileSync(join(__dirname, "DayFinanceFooter.tsx"), "utf8");
    assert.match(src, /income: totals\.earned/);
    assert.doesNotMatch(src, /totals\.planned/);
  });

});
