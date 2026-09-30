import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceDocument } from "./document";

// СКИДКА — НЕ УСЛУГА (владелец 2026-09-22: «дискаунт вынести, а не как
// услугу»): в таблице её нет, в итогах она строкой под «Subtotal».
describe("скидка на бумаге", () => {
  const doc = buildInvoiceDocument({
    language: "en",
    draft: {
      number: "INV-2026-104",
      issuedOn: "2026-09-22",
      dueOn: null,
      clientId: null,
      lines: [
        { title: "A/C Cleaning", qty: 4, unitPrice: 50 },
        { title: "Discount", qty: 1, unitPrice: -90 },
      ],
      vatMode: "exclusive",
      vatPercent: 19,
      subtotalNet: 110,
      vatAmount: 20.9,
      total: 130.9,
      currency: "EUR",
      notes: "",
    },
  });

  it("keeps the discount out of the services table", () => {
    assert.deepEqual(doc.lines.map((line) => line.title), ["A/C Cleaning"]);
  });

  it("prints four rows: subtotal, discount, VAT with its base, total", () => {
    assert.deepEqual(doc.totals.map((row) => row.label), [
      "Subtotal",
      "Discount",
      "VAT 19% on €110.00",
      "Total",
    ]);
    assert.match(doc.totals[1].value, /-€90\.00|−€90\.00/);
  });
});
