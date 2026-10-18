import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CLOSED_ACCOUNT_REASON,
  NO_TEAM_REASON,
  OFFLINE_OPERATION,
  READ_ONLY_REASON,
  operationCanSave,
  operationInputReason,
  operationReason,
  refundGuards,
  type OperationGateInput,
} from "./operation-guards";

const ready: OperationGateInput = {
  online: true,
  accountsFailed: false,
  txAccountClosed: false,
  amount: "10",
  amountCents: 1000,
  refundedTotal: 0,
  belowRefunded: false,
  lowersWhileRefundsUnknown: false,
  dateInFuture: false,
  accountMismatch: false,
  teamId: "t1",
  teamAccountsCount: 1,
  accountId: "a1",
  categoryId: "c1",
  receiptMissing: false,
  categoryName: "Fuel",
};

describe("refundGuards", () => {
  const base = {
    isEdit: true,
    type: "income" as const,
    amountCents: 500,
    gross: 5,
    refundedTotal: 0,
    txAmount: 10,
  };

  test("a new operation is never held by refunds", () => {
    const g = refundGuards({ ...base, isEdit: false, refundedTotal: 8 });
    assert.deepEqual(g, {
      refundsKnown: true,
      belowRefunded: false,
      refundHoldsAccount: false,
      lowersWhileRefundsUnknown: false,
    });
  });

  test("income below the refunded sum is blocked, compared in cents", () => {
    assert.equal(refundGuards({ ...base, refundedTotal: 8 }).belowRefunded, true);
    assert.equal(refundGuards({ ...base, gross: 0.3, refundedTotal: 0.1 + 0.2 }).belowRefunded, false);
    assert.equal(refundGuards({ ...base, type: "expense", refundedTotal: 8 }).belowRefunded, false);
    assert.equal(refundGuards({ ...base, amountCents: null, refundedTotal: 8 }).belowRefunded, false);
  });

  test("a refunded income keeps its account; unknown refunds hold it too", () => {
    assert.equal(refundGuards({ ...base, refundedTotal: 1 }).refundHoldsAccount, true);
    assert.equal(refundGuards({ ...base, refundedTotal: Infinity }).refundHoldsAccount, true);
    assert.equal(refundGuards({ ...base, refundedTotal: 0 }).refundHoldsAccount, false);
  });

  test("unknown refunds forbid only lowering the amount", () => {
    const unknown = { ...base, refundedTotal: Infinity };
    assert.equal(refundGuards(unknown).refundsKnown, false);
    assert.equal(refundGuards(unknown).belowRefunded, false);
    assert.equal(refundGuards(unknown).lowersWhileRefundsUnknown, true);
    assert.equal(refundGuards({ ...unknown, gross: 10 }).lowersWhileRefundsUnknown, false);
    assert.equal(refundGuards({ ...unknown, txAmount: -10 }).lowersWhileRefundsUnknown, true);
    assert.equal(refundGuards({ ...unknown, txAmount: null }).lowersWhileRefundsUnknown, false);
  });
});

describe("operationCanSave", () => {
  test("a complete form saves", () => {
    assert.equal(operationCanSave({ ...ready, canWrite: true, busy: false }), true);
  });

  test("every gate closes the button", () => {
    const live = { ...ready, canWrite: true, busy: false };
    for (const patch of [
      { canWrite: false },
      { busy: true },
      { online: false },
      { receiptMissing: true },
      { amountCents: null },
      { categoryId: null },
      { teamId: null },
      { accountId: null },
      { accountMismatch: true },
      { dateInFuture: true },
      { belowRefunded: true },
      { lowersWhileRefundsUnknown: true },
      { txAccountClosed: true },
    ]) {
      assert.equal(operationCanSave({ ...live, ...patch }), false, JSON.stringify(patch));
    }
  });
});

describe("operationInputReason", () => {
  test("a complete form has no reason", () => {
    assert.equal(operationInputReason(ready), null);
  });

  test("offline and a closed account are neutral doors, first in line", () => {
    assert.deepEqual(operationInputReason({ ...ready, online: false, accountsFailed: true }), {
      text: OFFLINE_OPERATION,
      error: false,
    });
    assert.deepEqual(operationInputReason({ ...ready, txAccountClosed: true, dateInFuture: true }), {
      text: CLOSED_ACCOUNT_REASON,
      error: false,
    });
  });

  test("failed accounts outrank input errors", () => {
    const r = operationInputReason({ ...ready, accountsFailed: true, amountCents: null });
    assert.equal(r?.error, true);
    assert.notEqual(r?.text, OFFLINE_OPERATION);
  });

  test("an empty amount names itself neutrally, a broken one as an error", () => {
    const empty = operationInputReason({ ...ready, amount: "", amountCents: null });
    assert.equal(empty?.error, false);
    const broken = operationInputReason({ ...ready, amount: "1,234", amountCents: null });
    assert.equal(broken?.error, true);
    assert.notEqual(broken?.text, empty?.text);
  });

  test("below refunded prints the refunded sum", () => {
    const r = operationInputReason({ ...ready, belowRefunded: true, refundedTotal: 12.5 });
    assert.equal(r?.error, true);
    assert.match(r?.text ?? "", /12[.,]50/);
  });

  test("a team without accounts, no team, no account, no category, no receipt", () => {
    assert.equal(operationInputReason({ ...ready, teamAccountsCount: 0 })?.error, true);
    assert.deepEqual(operationInputReason({ ...ready, teamId: null, teamAccountsCount: 0 }), {
      text: NO_TEAM_REASON,
      error: true,
    });
    assert.equal(operationInputReason({ ...ready, accountId: null })?.error, true);
    assert.equal(operationInputReason({ ...ready, categoryId: null })?.error, true);
    const receipt = operationInputReason({ ...ready, receiptMissing: true });
    assert.ok(receipt?.text.includes("«Fuel»"));
  });

  test("read-only outranks every input reason", () => {
    assert.deepEqual(operationReason(false, operationInputReason({ ...ready, online: false })), {
      text: READ_ONLY_REASON,
      error: false,
    });
    assert.equal(operationReason(true, null), null);
  });
});

describe("оплата долга не больше остатка", () => {
  test("больше остатка — кнопка погашена и причина названа", () => {
    const g = { ...ready, amount: "700", amountCents: 70000, debtRemainderCents: 60000 };
    assert.equal(operationCanSave({ ...g, canWrite: true, busy: false }), false);
    assert.match(operationInputReason(g)?.text ?? "", /^По долгу осталось /);
  });
  test("ровно остаток — можно", () => {
    const g = { ...ready, amount: "600", amountCents: 60000, debtRemainderCents: 60000 };
    assert.equal(operationCanSave({ ...g, canWrite: true, busy: false }), true);
  });
});

describe("доход с выданным чеком", () => {
  test("правка денег гасит кнопку и называет чек", () => {
    const g = { ...ready, receiptLocked: "REC-2026-0001" };
    assert.equal(operationCanSave({ ...g, canWrite: true, busy: false }), false);
    assert.match(operationInputReason(g)?.text ?? "", /^По доходу выдан чек REC-2026-0001 — /);
  });
});

describe("оплата долга с VAT «сверху» (16.10)", () => {
  test("долг гасит сумму с налогом, а не введённое нетто", async () => {
    const { overpaysDebt } = await import("./operation-guards");
    // Остаток 600, введено 550 + 19% сверху = 654,50 — больше остатка.
    assert.equal(overpaysDebt({ amountCents: 55000, grossCents: 65450, debtRemainderCents: 60000 }), true);
    assert.equal(overpaysDebt({ amountCents: 50000, grossCents: 59500, debtRemainderCents: 60000 }), false);
    // Без VAT — по введённому.
    assert.equal(overpaysDebt({ amountCents: 60001, debtRemainderCents: 60000 }), true);
  });
});

describe("сумма с VAT за пределом (16.10)", () => {
  test("введённое в пределе, а с налогом — нет: кнопка гаснет с причиной", async () => {
    const { grossTooLarge } = await import("./operation-guards");
    assert.equal(grossTooLarge({ grossCents: 999_999_999_999 }), false);
    assert.equal(grossTooLarge({ grossCents: 1_189_999_999_999 }), true);
    assert.equal(grossTooLarge({ grossCents: null }), false);
  });
});
