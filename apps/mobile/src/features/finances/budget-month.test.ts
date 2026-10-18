import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { budgetMonthFor, keepBudgetSeen } from "./category-budget";

describe("бюджет меряется месяцем операции", () => {
  test("операция прошлым числом — её месяц, а не сегодняшний", () => {
    assert.equal(budgetMonthFor("2026-09-28", "2026-10-16").key, "2026-09");
    assert.equal(budgetMonthFor("2026-09-28", "2026-10-16").to, "2026-09-30");
  });

  test("дня нет — сегодняшний месяц компании", () => {
    assert.equal(budgetMonthFor(null, "2026-10-16").key, "2026-10");
    assert.equal(budgetMonthFor(undefined, "2026-10-16").key, "2026-10");
  });
});

describe("проверка прошлого месяца не стирает «уже сообщено» текущего", () => {
  const seen = { "fuel:2026-10": 80 as const, "fuel:2026-08": 100 as const };

  test("прошлый месяц: свежие пороги его и память текущего", () => {
    assert.deepEqual(
      keepBudgetSeen(seen, { "fuel:2026-09": 100 }, "2026-09", "2026-10"),
      { "fuel:2026-10": 80, "fuel:2026-09": 100 },
    );
  });

  test("текущий месяц: только его свежие пороги, прошлые уходят", () => {
    assert.deepEqual(keepBudgetSeen(seen, { "fuel:2026-10": 100 }, "2026-10", "2026-10"), {
      "fuel:2026-10": 100,
    });
  });
});

describe("проводка бюджета", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = (f: string) => readFileSync(resolve(here, f), "utf8");

  test("строка бюджета в форме операции знает день операции", () => {
    assert.match(code("operation-sheet/OperationTopBlocks.tsx"), /budgetDate=\{date\}/);
    assert.match(code("use-category-budget.ts"), /budgetMonthFor\(/);
  });

  test("проверка после записи — по дню записанной операции", () => {
    assert.match(code("budget-notify.ts"), /budgetMonthFor\(occurredOn, today\)/);
    assert.match(code("queries.ts"), /checkBudgetsAfterWrite\(qc, tenantId, tx\.occurred_on\)/);
  });
});
