import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildDebtPaidPatch, type PayMethod } from "./payment";

describe("buildDebtPaidPatch", () => {
  test("persists every real tender in the canonical ledger fields", () => {
    const methods: PayMethod[] = ["cash", "card", "transfer", "other"];

    for (const method of methods) {
      const patch = buildDebtPaidPatch(null, { method, amount: 42 });
      assert.equal(patch.payment_status, "paid");
      assert.equal(patch.payment_method, method);
      assert.equal(patch.paid_amount, 42);
      assert.equal(patch.payments?.length, 1);
      assert.equal(patch.payments?.[0]?.method, method);
      assert.equal(patch.payments?.[0]?.amount, 42);

      if (method === "cash") {
        assert.equal(patch.payment?.cashAmount, 42);
        assert.equal(patch.payment?.cardAmount, 0);
      } else if (method === "card") {
        assert.equal(patch.payment?.cashAmount, 0);
        assert.equal(patch.payment?.cardAmount, 42);
      } else {
        assert.equal(patch.payment, null);
      }
    }
  });

  test("does not disguise transfer as cash in the legacy payment mirror", () => {
    const patch = buildDebtPaidPatch(
      {
        payments: [
          {
            id: "existing-transfer",
            method: "transfer",
            amount: 30,
            paid_at: "2026-07-20T10:00:00.000Z",
          },
        ],
        payment: null,
        payment_status: "partial",
        paid_amount: 30,
      },
      { method: "card", amount: 20 },
    );

    assert.equal(patch.paid_amount, 50);
    assert.deepEqual(
      patch.payments?.map(({ method, amount }) => ({ method, amount })),
      [
        { method: "transfer", amount: 30 },
        { method: "card", amount: 20 },
      ],
    );
    assert.equal(patch.payment?.cashAmount, 0);
    assert.equal(patch.payment?.cardAmount, 20);
  });

  test("keeps prepaid echo out of paid_amount when cash settles the remainder", () => {
    const patch = buildDebtPaidPatch(
      {
        payments: [],
        payment: null,
        payment_status: "unpaid",
        // Legacy/server backfill echoes a 20 prepayment here. The canonical
        // prepayment lives in prepaid_amount outside this snapshot and must
        // not be seeded into the settlement ledger a second time.
        paid_amount: 20,
      },
      { method: "cash", amount: 80 },
    );

    assert.equal(patch.paid_amount, 80);
    assert.deepEqual(
      patch.payments?.map(({ method, amount }) => ({ method, amount })),
      [{ method: "cash", amount: 80 }],
    );
  });

  test("keeps a cash partial payment open and closes the later card remainder", () => {
    const first = buildDebtPaidPatch(null, {
      method: "cash",
      amount: 40,
      remainingDebt: 100,
    });
    assert.equal(first.payment_status, "partial");
    assert.equal(first.paid_amount, 40);

    const second = buildDebtPaidPatch(
      {
        payments: first.payments ?? [],
        payment: first.payment ?? null,
        payment_status: first.payment_status,
        paid_amount: first.paid_amount,
      },
      { method: "card", amount: 60, remainingDebt: 60 },
    );
    assert.equal(second.payment_status, "paid");
    assert.equal(second.paid_amount, 100);
    assert.deepEqual(
      second.payments?.map(({ method, amount }) => ({ method, amount })),
      [
        { method: "cash", amount: 40 },
        { method: "card", amount: 60 },
      ],
    );
  });
});
