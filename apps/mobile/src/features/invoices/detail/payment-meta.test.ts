import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { earliestPayment, paymentMeta } from "./payment-meta";

const payment = (over: Partial<InvoicePaymentLedger> = {}): InvoicePaymentLedger => ({
  id: "p1",
  invoice_id: "i1",
  type: "income",
  amount: 100,
  account_id: "a1",
  payment_method: "card",
  occurred_on: "2026-10-04",
  refund_of_id: null,
  notes: null,
  created_at: "2026-10-04T10:00:00Z",
  ...over,
});

const base = {
  refundable: 100,
  refundInAppointment: false,
  canOpenAppointment: false,
  appointmentLookupComplete: true,
};

describe("paymentMeta", () => {
  test("date, account and method", () => {
    const meta = paymentMeta({ ...base, payment: payment(), accountName: "Revolut" });
    assert.equal(meta.length, 3);
    assert.equal(meta[1], "Revolut");
    assert.equal(meta[2], "Карта");
  });

  test("the method is dropped when it repeats the account name", () => {
    const meta = paymentMeta({
      ...base,
      payment: payment({ payment_method: "cash" }),
      accountName: "Наличные",
    });
    assert.deepEqual(meta.slice(1), ["Наличные"]);
  });

  test("no account — says so; fully refunded income — says so", () => {
    const meta = paymentMeta({ ...base, payment: payment({ payment_method: null }), refundable: 0 });
    assert.deepEqual(meta.slice(1), ["Счёт не указан", "возвращён полностью"]);
  });

  test("a refund row is never «возвращён полностью»", () => {
    const meta = paymentMeta({ ...base, payment: payment({ type: "refund", payment_method: null }), refundable: 0, accountName: "A" });
    assert.deepEqual(meta.slice(1), ["A"]);
  });

  test("refund through the appointment: open, blocked or still loading", () => {
    const open = { ...base, payment: payment({ payment_method: null }), accountName: "A", refundInAppointment: true };
    assert.equal(paymentMeta({ ...open, canOpenAppointment: true }).at(-1), "возврат оформляется в заявке");
    assert.equal(
      paymentMeta(open).at(-1),
      "связанная заявка недоступна — возврат здесь заблокирован",
    );
    assert.equal(
      paymentMeta({ ...open, appointmentLookupComplete: false }).at(-1),
      "загрузка связанной заявки",
    );
  });
});

describe("earliestPayment", () => {
  test("picks the earliest by created_at without mutating the input", () => {
    const list = [
      payment({ id: "b", created_at: "2026-10-05T00:00:00Z" }),
      payment({ id: "a", created_at: "2026-10-01T00:00:00Z" }),
    ];
    assert.equal(earliestPayment(list)?.id, "a");
    assert.equal(list[0].id, "b");
    assert.equal(earliestPayment([]), undefined);
  });
});

test("дата платежа — по языку интерфейса, а не «ru-RU» по умолчанию", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "payment-meta.ts"), "utf8");
  assert.match(source, /formatInvoiceDate\(payment\.occurred_on, intlLocale\(\)\)/);
});
