import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateInvoiceSettlement,
  type InvoiceLedgerWithLines,
} from "@babun/shared/local/finance/invoice-ledger";
import { buildInvoiceDocument } from "@/lib/paper/document";
import { buildInvoicePdfHtml } from "@/lib/paper/pdf";

// БУМАГА ИНВОЙСА ПО ЗАПИСИ ГОВОРИТ, ЧТО УЖЕ ПОЛУЧЕНО: предоплата записи €260 —
// «Paid €260.00 · Balance due €40.00», хотя строк истории оплат у инвойса нет.
const invoice = {
  id: "inv-1",
  tenant_id: "t",
  number: "INV-2026-001",
  year: 2026,
  seq: 1,
  issued_on: "2026-10-08",
  due_on: null,
  client_id: null,
  appointment_id: "a1",
  brigade_id: null,
  subtotal_net: 300,
  vat_percent: 0,
  vat_amount: 0,
  total: 300,
  currency: "EUR",
  language: "en",
  vat_mode: "off",
  status: "issued",
  pdf_url: null,
  notes: "",
  created_at: "2026-10-08T08:00:00Z",
  updated_at: "2026-10-08T08:00:00Z",
  created_by: null,
  lines: [],
} as unknown as InvoiceLedgerWithLines;

const build = (appointmentMoney: number) =>
  buildInvoiceDocument({
    invoice,
    settlement: calculateInvoiceSettlement(invoice, [], appointmentMoney),
    payments: [],
    language: "en",
  });

describe("получено и к оплате на бумаге", () => {
  it("деньги записи — две строки под «Оплатой», и в PDF тоже", () => {
    const doc = build(260);
    assert.equal(doc.settlement.length, 2);
    assert.match(doc.settlement[0].value, /260\.00/);
    assert.match(doc.settlement[1].value, /40\.00/);
    const html = buildInvoicePdfHtml({
      invoice,
      settlement: calculateInvoiceSettlement(invoice, [], 260),
      payments: [],
      language: "en",
    });
    assert.match(html, /40\.00/);
  });

  it("ничего не получено — строк нет", () => {
    assert.equal(build(0).settlement.length, 0);
  });
});
