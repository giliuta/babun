import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import { buildInvoiceDocument } from "./document";
import { buildInvoicePdfHtml } from "./pdf";
import { buildInvoiceShareText } from "./text";

// КРЕДИТ-НОТА ПЕЧАТАЛАСЬ СЛОМАННЫМ «INVOICE» (аудит 03.10): сервер
// (`_issue_credit_note`) пишет только суммы с минусом и русскую причину —
// бумага говорила «INVOICE», «No lines yet», «Subtotal −€84.03», «Total
// −€100.00» без строки VAT (минус уходил в ветку «без налога») и без ссылки на
// отменённый инвойс, кроме русского примечания на английском документе.

const note: InvoiceLedgerWithLines = {
  id: "cn-1",
  tenant_id: "tenant-1",
  number: "CN-2026-0001",
  year: 2026,
  seq: 1,
  issued_on: "2026-10-03",
  due_on: null,
  client_id: "client-1",
  appointment_id: null,
  brigade_id: null,
  subtotal_net: -84.03,
  vat_percent: 19,
  vat_amount: -15.97,
  total: -100,
  currency: "EUR",
  language: "en",
  vat_mode: "inclusive",
  status: "issued",
  pdf_url: null,
  notes: "Отмена инвойса INV-2026-0007",
  created_at: "2026-10-03T08:00:00Z",
  updated_at: "2026-10-03T08:00:00Z",
  created_by: null,
  lines: [],
} as InvoiceLedgerWithLines;

const settlement = {
  income: 0,
  refunded: 0,
  paid: 0,
  remaining: 0,
  overpaid: 0,
  isPartial: false,
  isPaid: false,
};

const input = {
  invoice: note,
  settlement,
  payments: [],
  language: "en" as const,
  creditNote: { originalNumber: "INV-2026-0007" },
};

describe("кредит-нота на бумаге", () => {
  const doc = buildInvoiceDocument(input);

  it("называется кредит-нотой и ссылается на отменённый инвойс", () => {
    assert.equal(doc.title, "CREDIT NOTE");
    assert.equal(doc.reference, "Credits invoice INV-2026-0007");
    assert.equal(doc.footer, "Credit note CN-2026-0001");
  });

  it("таблица — строка отмены, а не «No lines yet»", () => {
    assert.equal(doc.lines.length, 1);
    assert.equal(doc.lines[0]?.title, "Cancellation of invoice INV-2026-0007");
    assert.match(doc.lines[0]?.total ?? "", /84\.03/);
  });

  it("налог с минусом — тоже строка налога", () => {
    const vat = doc.totals.find((row) => row.label.startsWith("incl.") || /VAT/.test(row.label));
    assert.ok(vat, doc.totals.map((row) => row.label).join(" | "));
    assert.match(vat.value, /15\.97/);
  });

  it("русская причина по умолчанию и реквизиты для оплаты не печатаются", () => {
    assert.equal(doc.notes, "");
    assert.deepEqual(doc.payTo, []);
  });

  it("своя причина печатается как есть", () => {
    const own = buildInvoiceDocument({ ...input, invoice: { ...note, notes: "Client returned the unit" } });
    assert.equal(own.notes, "Client returned the unit");
  });

  it("PDF и текст говорят то же", () => {
    const html = buildInvoicePdfHtml(input);
    assert.match(html, /<h1>CREDIT NOTE<\/h1>/);
    assert.match(html, /Credits invoice INV-2026-0007/);
    assert.doesNotMatch(html, /No lines yet/);
    const text = buildInvoiceShareText(doc);
    assert.match(text, /^Credit note CN-2026-0001$/m);
    assert.match(text, /^Credits invoice INV-2026-0007$/m);
  });

  it("обычный инвойс не меняется", () => {
    const invoice = buildInvoiceDocument({ ...input, creditNote: null, invoice: { ...note, number: "INV-1", subtotal_net: 84.03, vat_amount: 15.97, total: 100, notes: "" } });
    assert.equal(invoice.title, "INVOICE");
    assert.equal(invoice.reference, null);
  });
});
