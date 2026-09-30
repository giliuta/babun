import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ПОЛОСА «ДОХОД / РАСХОД» ПОД СЕТКОЙ — ТОЛЬКО ПРИШЕДШИЕ ДЕНЬГИ (владелец
// 2026-09-24): неоплаченная запись не доход ни в прошлом, ни сегодня, ни
// завтра. С 2026-09-30 полоса, клетка месяца и шторка дня считают одним
// правилом с «Финансами» — `day-money.ts` (случаи — `day-money.test.ts`).
describe("доход под сеткой календаря", () => {
  test("полоса берёт пришедшее за день, а не план — в любой день", () => {
    const src = readFileSync(join(__dirname, "DayFinanceFooter.tsx"), "utf8");
    assert.match(src, /income: money\.income/);
    assert.doesNotMatch(src, /\.planned/);
    assert.doesNotMatch(src, /computeDayFinance/);
  });

  test("месяц и шторка дня — тем же правилом, что полоса", () => {
    for (const file of ["MonthView.tsx", "DayFinanceSheet.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      assert.match(src, /dayMoney\(/, file);
      assert.doesNotMatch(src, /computeDayFinance\(/, file);
    }
  });

});
