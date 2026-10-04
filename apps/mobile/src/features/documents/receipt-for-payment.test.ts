import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCustomServiceId } from "@babun/shared/local/appointments";
import {
  incomesAwaitingInvoice,
  incomesAwaitingReceipt,
  paymentLinesTotal,
  paymentReceiptLines,
} from "./receipt-for-payment";

const tx = (over: Record<string, unknown>) => ({
  id: "t1",
  type: "income" as const,
  amount: 50,
  vat_mode: null,
  vat_amount: null,
  refund_of_id: null,
  created_at: "2026-10-03T10:00:00Z",
  ...over,
}) as Parameters<typeof incomesAwaitingReceipt>[0][number];

// Владелец 03.10: оплачено — чек заполняется сам, проверяю и выставляю.
describe("чек на принятую оплату", () => {
  it("строки сходятся с суммой без налога сверху", () => {
    assert.equal(paymentLinesTotal({ amount: 59.5, vat_mode: "exclusive", vat_amount: 9.5 }), 50);
    assert.equal(paymentLinesTotal({ amount: 59.5, vat_mode: "inclusive", vat_amount: 9.5 }), 59.5);
    assert.equal(paymentLinesTotal({ amount: 50, vat_mode: null, vat_amount: null }), 50);
  });

  it("чек ждут только доходы без чека и не возвращённые целиком", () => {
    const ledger = [
      tx({ id: "a", created_at: "2026-10-03T09:00:00Z" }),
      tx({ id: "b" }),
      tx({ id: "r", type: "refund", amount: -50, refund_of_id: "b" }),
      tx({ id: "c", created_at: "2026-10-03T11:00:00Z" }),
      tx({ id: "d", created_at: "2026-10-03T08:00:00Z" }),
    ];
    const ids = incomesAwaitingReceipt(ledger, [{ transaction_id: "c" }]).map((t) => t.id);
    assert.deepEqual(ids, ["d", "a"]);
  });

  it("берёт строки инвойса оплаты", () => {
    const lines = paymentReceiptLines(
      { amount: 70, vat_mode: null, vat_amount: null },
      {
        invoiceLines: [
          { title: "Чистка", qty: 2, unit: "шт", unit_price: 30 },
          { title: "Выезд", qty: 1, unit: null, unit_price: 10 },
        ],
      },
      "Оплата",
    );
    assert.deepEqual(lines.map((l) => [l.serviceName, l.quantity, l.totalPrice]), [
      ["Чистка", 2, 60],
      ["Выезд", 1, 10],
    ]);
    assert.ok(lines.every((l) => isCustomServiceId(l.serviceId)));
  });

  it("берёт услуги записи", () => {
    const service = {
      serviceId: "svc", quantity: 1, pricePerUnit: 50, originalPrice: 50, totalPrice: 50,
      duration: 60, serviceName: "A/C Cleaning",
    };
    const lines = paymentReceiptLines(
      { amount: 50, vat_mode: null, vat_amount: null },
      { appointment: { services: [service] } },
      "Оплата",
    );
    assert.deepEqual(lines, [service]);
  });

  // Владелец 04.10: «оно должно выписывать услуги из записи», и при
  // предоплате тоже — бумага: «Итого работ €50», «Получено €20».
  it("частичная оплата — те же услуги записи", () => {
    const service = {
      serviceId: "svc", quantity: 1, pricePerUnit: 50, originalPrice: 50, totalPrice: 50, duration: 60,
    };
    const lines = paymentReceiptLines(
      { amount: 20, vat_mode: null, vat_amount: null },
      { appointment: { services: [service] } },
      "Оплата",
    );
    assert.deepEqual(lines, [service]);
  });

  it("без записи и инвойса — одна строка на сумму оплаты", () => {
    const lines = paymentReceiptLines({ amount: 20, vat_mode: null, vat_amount: null }, {}, "Оплата");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].serviceName, "Оплата");
    assert.equal(lines[0].totalPrice, 20);
  });
});

// Проверка на 17e (04.10): оплата инвойса с VAT сверху — «VAT 19%», а не «в сумме».
describe("подпись VAT на бумаге чека", () => {
  it("сверху — просто «VAT 19%»; внутри — «в сумме»", async () => {
    const { buildDraftReceiptDocument } = await import("./receipt-document");
    const base = {
      numberLabel: "Черновик",
      seller: { name: "Seller" },
      currency: "EUR",
      issuedOn: "2026-10-04",
      discountAmount: 0,
      vatRate: 19,
      vatAmount: 28.5,
    };
    const onTop = buildDraftReceiptDocument({
      ...base,
      lines: [{ name: "A/C", qty: 3, unitPrice: 50, sum: 150 }],
      total: 178.5,
    });
    assert.equal(onTop.vat?.label, "VAT 19%");
    const inside = buildDraftReceiptDocument({
      ...base,
      lines: [{ name: "A/C", qty: 1, unitPrice: 178.5, sum: 178.5 }],
      total: 178.5,
    });
    assert.equal(inside.vat?.label, "VAT 19% в сумме");
  });
});

// Владелец 04.10: оплачено заранее — инвойс выставляется на эти деньги.
describe("инвойс на принятую оплату", () => {
  it("ждут доходы без инвойса и не возвращённые целиком, ранние первыми", () => {
    const ledger = [
      { ...tx({ id: "a", created_at: "2026-10-03T09:00:00Z" }), invoice_id: null },
      { ...tx({ id: "b" }), invoice_id: null },
      { ...tx({ id: "r", type: "refund", amount: -50, refund_of_id: "b" }), invoice_id: null },
      { ...tx({ id: "c", created_at: "2026-10-03T08:00:00Z" }), invoice_id: "inv-1" },
      { ...tx({ id: "d", created_at: "2026-10-03T07:00:00Z" }), invoice_id: null },
    ];
    assert.deepEqual(incomesAwaitingInvoice(ledger).map((t) => t.id), ["d", "a"]);
  });
});
