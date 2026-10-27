import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { deletableByHand, refundDeleteNotice } from "./operation-delete";

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
    // Расход записи — тоже из записи, а не свайпом в ленте.
    assert.equal(deletableByHand(tx({ type: "expense", appointment_id: "a1" })), false);
    assert.equal(deletableByHand(tx({ invoice_id: "i1" })), false);
    assert.equal(deletableByHand(tx({ source: "auto" })), false);
  });

  test("перевод — только с парой", () => {
    assert.equal(deletableByHand(tx({ type: "transfer" })), false);
    assert.equal(deletableByHand(tx({ type: "transfer", transfer_group_id: "g1" })), true);
  });

  test("доход с возвратом или с неизвестной суммой возвратов не удаляется", () => {
    assert.equal(refundDeleteNotice(tx({ type: "income" }), 0), null);
    assert.equal(refundDeleteNotice(tx({ type: "income" }), 10)?.title, "Удалить нельзя");
    assert.ok(refundDeleteNotice(tx({ type: "income" }), undefined));
    assert.equal(refundDeleteNotice(tx({}), undefined), null);
  });

  test("суммы возвратов не приехали — не «есть возврат»", () => {
    const notice = refundDeleteNotice(tx({ type: "income" }), undefined);
    assert.ok(notice && !/есть возврат/.test(notice.message));
  });
});
