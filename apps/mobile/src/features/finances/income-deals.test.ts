import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { incomeDeals } from "./income-deals";

function tx(over: Partial<FinanceTransaction> & { id: string; type: FinanceTransaction["type"]; amount: number }): FinanceTransaction {
  return {
    tenant_id: "t",
    team_id: null,
    account_id: "acc",
    category_id: null,
    client_id: null,
    appointment_id: null,
    appointment_payment_kind: null,
    invoice_id: null,
    refund_of_id: null,
    transfer_group_id: null,
    payment_method: null,
    notes: null,
    occurred_on: "2026-09-06",
    source: "auto",
    created_at: "2026-09-06T10:00:00Z",
    ...over,
  } as FinanceTransaction;
}

describe("incomeDeals", () => {
  test("снятая оплата прячется парой: и откат, и исходная строка", () => {
    const rows = [
      tx({ id: "i1", type: "income", amount: 50 }),
      tx({ id: "r1", type: "refund", amount: -50, refund_of_id: "i1" }),
      tx({ id: "i2", type: "income", amount: 44 }),
    ];
    assert.deepEqual(incomeDeals(rows).map((r) => r.id), ["i2"]);
  });

  test("частичный возврат остаётся вместе с исходной оплатой", () => {
    const rows = [
      tx({ id: "i1", type: "income", amount: 100 }),
      tx({ id: "r1", type: "refund", amount: -30, refund_of_id: "i1" }),
    ];
    assert.deepEqual(incomeDeals(rows).map((r) => r.id), ["i1", "r1"]);
  });

  test("расходы и переводы в доход не попадают; возврат без исходника виден", () => {
    const rows = [
      tx({ id: "e1", type: "expense", amount: 20 }),
      tx({ id: "t1", type: "transfer", amount: -10 }),
      tx({ id: "r0", type: "refund", amount: -15, refund_of_id: "missing" }),
      tx({ id: "i1", type: "income", amount: 5 }),
    ];
    assert.deepEqual(incomeDeals(rows).map((r) => r.id), ["r0", "i1"]);
  });

  test("сумма оставшихся строк равна нетто дохода периода", () => {
    const rows = [
      tx({ id: "i1", type: "income", amount: 135 }),
      tx({ id: "r1", type: "refund", amount: -135, refund_of_id: "i1" }),
      tx({ id: "i2", type: "income", amount: 34 }),
      tx({ id: "i3", type: "income", amount: 44 }),
    ];
    const net = rows.reduce((s, r) => s + (r.type === "income" || r.type === "refund" ? r.amount : 0), 0);
    const shown = incomeDeals(rows).reduce((s, r) => s + r.amount, 0);
    assert.equal(shown, net);
    assert.equal(shown, 78);
  });
});
