import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { ledgerExtrasByDay, ledgerExtrasForDay } from "./day-ledger";

const tx = (over: Partial<FinanceTransaction> & { id: string; type: FinanceTransaction["type"]; amount: number }): FinanceTransaction =>
  ({
    source: "manual",
    occurred_on: "2026-09-06",
    notes: null,
    ...over,
  }) as FinanceTransaction;

describe("ledgerExtrasForDay", () => {
  test("ручные доход и расход дня становятся «ручными операциями»; авто и переводы — нет", () => {
    const extras = ledgerExtrasForDay(
      [
        tx({ id: "tip", type: "income", amount: 20, notes: "Чаевые" }),
        tx({ id: "fuel", type: "expense", amount: 35, notes: "Заправка" }),
        tx({ id: "auto", type: "income", amount: 100, source: "auto" }),
        tx({ id: "move", type: "transfer", amount: -50 }),
        tx({ id: "other-day", type: "expense", amount: 5, occurred_on: "2026-09-07" }),
      ],
      "2026-09-06",
    );
    assert.deepEqual(
      extras.map((e) => [e.kind, e.name, e.amount]),
      [
        ["income", "Чаевые", 20],
        ["expense", "Заправка", 35],
      ],
    );
  });

  test("ручной возврат — отрицательный доход, без заметки — имя по виду", () => {
    const [refund, plain] = ledgerExtrasForDay(
      [
        tx({ id: "r", type: "refund", amount: -15 }),
        tx({ id: "e", type: "expense", amount: 7, notes: "  " }),
      ],
      "2026-09-06",
    );
    assert.equal(refund.kind, "income");
    assert.equal(refund.amount, -15);
    assert.equal(plain.name, "Расход");
  });

  test("по дням: только дни с ручными проводками", () => {
    const byDay = ledgerExtrasByDay([
      tx({ id: "a", type: "income", amount: 1, occurred_on: "2026-09-01" }),
      tx({ id: "b", type: "income", amount: 2, occurred_on: "2026-09-02", source: "auto" }),
    ]);
    assert.deepEqual([...byDay.keys()], ["2026-09-01"]);
  });
});
