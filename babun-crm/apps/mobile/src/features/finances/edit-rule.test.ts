import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";

// Тап по операции ведёт в правку — но не по всякой. Ошибка здесь либо запирает
// обычный расход за лишним экраном, либо пускает править то, что принадлежит
// записи или документу, и деньги разъезжаются с ними.
function tx(over: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: "t1",
    type: "expense",
    amount: 100,
    source: "manual",
    invoice_id: null,
    ...over,
  } as FinanceTransaction;
}

describe("что можно править прямо в форме", () => {
  test("обычные доход и расход — можно", () => {
    assert.equal(canEditTransaction(tx({ type: "expense" })), true);
    assert.equal(canEditTransaction(tx({ type: "income" })), true);
  });

  test("проводка из записи меняется в самой записи", () => {
    assert.equal(canEditTransaction(tx({ source: "auto" })), false);
  });

  test("операция с инвойсом принадлежит документу", () => {
    assert.equal(canEditTransaction(tx({ invoice_id: "inv" })), false);
  });

  test("перевод и возврат правятся своими путями", () => {
    assert.equal(canEditTransaction(tx({ type: "transfer" })), false);
    assert.equal(canEditTransaction(tx({ type: "refund" })), false);
  });
});
