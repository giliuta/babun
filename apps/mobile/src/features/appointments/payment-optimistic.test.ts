import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import { paymentRows } from "./payment-draft";
import { optimisticCancelPayment, optimisticRecordPayment } from "./payment-optimistic";

// Мгновенная оплата обязана совпасть с тем, что вернёт сервер
// (`record_appointment_payment`): иначе плитка «оплачено» мигнёт на ответе.

const appt = (over: Partial<Appointment> = {}): Appointment =>
  ({
    id: "a1",
    status: "scheduled",
    payment_status: "unpaid",
    total_amount: 50,
    prepaid_amount: 0,
    prepayments: [],
    payments: [],
    payment: null,
    paid_amount: 0,
    ...over,
  }) as unknown as Appointment;

const base = {
  requestId: "req-1",
  accountId: "cash-acc",
  accountKind: "cash" as const,
  closeVisit: false,
  paidAt: "2026-09-30T09:00:00.000Z",
};

describe("оплата по тапу — как сервер", () => {
  test("предоплата: сумма, строка со счётом, статус «не оплачено», пока не вся", () => {
    const next = optimisticRecordPayment(appt(), { ...base, amount: 20, kind: "prepayment" });
    assert.equal(next.prepaid_amount, 20);
    assert.equal(next.payment_status, "unpaid");
    assert.equal(getPaidAmount(next), 20);
    assert.equal(getDebtAmount(next), 30);
    assert.deepEqual(
      paymentRows(next).map((r) => [r.id, r.kind, r.amount, r.accountId, r.cancellable]),
      [["req-1", "prepayment", 20, "cash-acc", true]],
    );
  });

  test("вся сумма оплатой после начала — «оплачено» и визит закрыт", () => {
    const next = optimisticRecordPayment(appt(), {
      ...base,
      amount: 50,
      kind: "settlement",
      closeVisit: true,
      accountKind: "card",
    });
    assert.equal(next.payment_status, "paid");
    assert.equal(next.status, "completed");
    assert.equal(next.payments[0].method, "card");
    assert.equal(getDebtAmount(next), 0);
  });

  test("частичная оплата поверх предоплаты — «частично», долг — остаток", () => {
    const start = optimisticRecordPayment(appt(), { ...base, amount: 20, kind: "prepayment" });
    const next = optimisticRecordPayment(start, {
      ...base,
      requestId: "req-2",
      amount: 10,
      kind: "settlement",
    });
    assert.equal(next.payment_status, "partial");
    assert.equal(getPaidAmount(next), 30);
    assert.equal(getDebtAmount(next), 20);
    assert.equal(next.status, "scheduled");
  });

  test("снятие возвращает запись к прежнему долгу", () => {
    const paid = optimisticRecordPayment(appt(), { ...base, amount: 50, kind: "settlement" });
    const back = optimisticCancelPayment(paid, "req-1");
    assert.equal(back.payment_status, "unpaid");
    assert.equal(getDebtAmount(back), 50);
    assert.equal(paymentRows(back).length, 0);

    const pre = optimisticRecordPayment(appt(), { ...base, amount: 20, kind: "prepayment" });
    const preBack = optimisticCancelPayment(pre, "req-1");
    assert.equal(preBack.prepaid_amount, 0);
    assert.equal(getDebtAmount(preBack), 50);
  });

  // Аудит 2026-10-03: снятие считает статус, способ и счёт из ОСТАВШИХСЯ
  // строк — как `cancel_appointment_payment`.
  test("снята предоплата при живой оплате — «частично», счёт оплаты", () => {
    const pre = optimisticRecordPayment(appt({ total_amount: 100 }), {
      ...base,
      amount: 30,
      kind: "prepayment",
    });
    const both = optimisticRecordPayment(pre, {
      ...base,
      requestId: "req-2",
      accountId: "card-acc",
      accountKind: "card",
      amount: 40,
      kind: "settlement",
    });
    const back = optimisticCancelPayment(both, "req-1");
    assert.equal(back.prepaid_amount, 0);
    assert.equal(back.paid_amount, 40);
    assert.equal(back.payment_status, "partial");
    assert.equal(back.payment_method, "card");
    assert.equal(back.payment_account_id, "card-acc");
    assert.equal(getDebtAmount(back), 60);
  });

  test("снята оплата, осталась предоплата — способ и счёт предоплаты", () => {
    const pre = optimisticRecordPayment(appt({ total_amount: 100 }), {
      ...base,
      amount: 30,
      kind: "prepayment",
    });
    const both = optimisticRecordPayment(pre, {
      ...base,
      requestId: "req-2",
      accountId: "card-acc",
      accountKind: "card",
      amount: 40,
      kind: "settlement",
    });
    const back = optimisticCancelPayment(both, "req-2");
    assert.equal(back.paid_amount, 0);
    assert.equal(back.prepaid_amount, 30);
    assert.equal(back.payment_status, "unpaid");
    assert.equal(back.payment_method, "cash");
    assert.equal(back.payment_account_id, "cash-acc");
  });

  test("снято всё — ни способа, ни счёта", () => {
    const paid = optimisticRecordPayment(appt(), { ...base, amount: 50, kind: "settlement" });
    const back = optimisticCancelPayment(paid, "req-1");
    assert.equal(back.payment_method, undefined);
    assert.equal(back.payment_account_id, null);
  });

  test("чужой id — запись не меняется", () => {
    const a = appt();
    assert.equal(optimisticCancelPayment(a, "nope"), a);
  });
});
