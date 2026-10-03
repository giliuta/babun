import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { deletableByHand, refundBlocksDelete } from "./operation-delete";

const base = {
  id: "t1",
  type: "expense",
  source: "manual",
  invoice_id: null,
  appointment_id: null,
  transfer_group_id: null,
} as unknown as FinanceTransaction;
const tx = (patch: Partial<FinanceTransaction>) => ({ ...base, ...patch }) as FinanceTransaction;

describe("свайп «Удалить» в ленте", () => {
  test("ручной расход и доход — да", () => {
    assert.equal(deletableByHand(tx({})), true);
    assert.equal(deletableByHand(tx({ type: "income" })), true);
  });

  test("доход через услугу, проводка инвойса и авто-строки — нет", () => {
    assert.equal(deletableByHand(tx({ type: "income", appointment_id: "a1" })), false);
    assert.equal(deletableByHand(tx({ invoice_id: "i1" })), false);
    assert.equal(deletableByHand(tx({ source: "auto" })), false);
  });

  test("перевод — только с парой", () => {
    assert.equal(deletableByHand(tx({ type: "transfer" })), false);
    assert.equal(deletableByHand(tx({ type: "transfer", transfer_group_id: "g1" })), true);
  });

  test("доход с возвратом или с неизвестной суммой возвратов не удаляется", () => {
    assert.equal(refundBlocksDelete(tx({ type: "income" }), 0), false);
    assert.equal(refundBlocksDelete(tx({ type: "income" }), 10), true);
    assert.equal(refundBlocksDelete(tx({ type: "income" }), undefined), true);
    assert.equal(refundBlocksDelete(tx({}), undefined), false);
  });
});
