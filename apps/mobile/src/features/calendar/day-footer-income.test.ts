import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// ПОЛОСА «ДОХОД / РАСХОД» ПОД СЕТКОЙ — ТОЛЬКО ПРИШЕДШИЕ ДЕНЬГИ (владелец
// 2026-09-24): неоплаченная запись не доход ни в прошлом, ни сегодня, ни
// завтра. Полоса, клетка месяца и шторка дня считают одним правилом —
// `day-money.ts` (случаи — `day-money.test.ts`): с 2026-10-01 деньги записи
// стоят в дне записи, поэтому каждая из трёх берёт и операции своих записей.
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

  test("все три берут операции своих записей — предоплата неделей раньше тоже видна", () => {
    for (const file of ["DayFinanceFooter.tsx", "MonthView.tsx", "DayFinanceSheet.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      assert.match(src, /useAppointmentsLedger\(/, file);
      // Отбор по дню операции до `dayMoney` вернул бы старое правило.
      assert.doesNotMatch(src, /\.filter\(\(tx\) => tx\.occurred_on === ymd\)/, file);
    }
  });

});
