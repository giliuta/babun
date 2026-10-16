import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import { buildInvoiceDocument } from "@/lib/paper/document";
import { buildInvoicePdfHtml } from "@/lib/paper/pdf";

// КРЕДИТ-НОТА ПЕЧАТАЛАСЬ СЛОМАННЫМ «INVOICE»: сервер
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

  it("PDF говорит то же", () => {
    const html = buildInvoicePdfHtml(input);
    assert.match(html, /<h1>CREDIT NOTE<\/h1>/);
    assert.match(html, /Credits invoice INV-2026-0007/);
    assert.doesNotMatch(html, /No lines yet/);
  });

  it("обычный инвойс не меняется", () => {
    const invoice = buildInvoiceDocument({ ...input, creditNote: null, invoice: { ...note, number: "INV-1", subtotal_net: 84.03, vat_amount: 15.97, total: 100, notes: "" } });
    assert.equal(invoice.title, "INVOICE");
    assert.equal(invoice.reference, null);
  });
});

// ПОЛНАЯ НОТА НЕСЁТ ПОЗИЦИИ ИНВОЙСА С МИНУСОМ (`_issue_credit_note`,
// `_issue_receipt_credit_note`). Бумага отбрасывала их как «скидку» и печатала
// пустую таблицу и «Discount −€100» вместо сторнированных работ.
describe("полная кредит-нота с позициями", () => {
  const line = (id: string, title: string, qty: number, unit_price: number) => ({
    id, invoice_id: "cn-1", position: 0, title, qty, unit_price, total: qty * unit_price, description: null, unit: null,
  });
  const full = (lines: ReturnType<typeof line>[], total: number) =>
    buildInvoiceDocument({
      ...input,
      invoice: { ...note, subtotal_net: total, vat_amount: 0, vat_mode: "off", total, lines } as InvoiceLedgerWithLines,
    });

  it("позиции печатаются с минусом, скидки нет", () => {
    const doc = full([line("a", "Чистка кондиционера", 2, -50)], -100);
    assert.deepEqual(doc.lines.map((l) => l.title), ["Чистка кондиционера"]);
    assert.match(doc.lines[0]?.total ?? "", /-.*100\.00|−.*100\.00/);
    assert.equal(doc.totals.some((row) => row.label === "Discount"), false);
    assert.match(doc.totals.find((row) => row.grand)?.value ?? "", /100\.00/);
  });

  it("скидка инвойса в ноте — плюсом в итогах, а не позицией", () => {
    const doc = full([line("a", "Чистка кондиционера", 2, -50), line("d", "Скидка", 1, 20)], -80);
    assert.deepEqual(doc.lines.map((l) => l.title), ["Чистка кондиционера"]);
    const subtotal = doc.totals.find((row) => row.label === "Subtotal");
    const discount = doc.totals.find((row) => row.label === "Discount");
    assert.match(subtotal?.value ?? "", /^[-−].*100\.00$/);
    assert.match(discount?.value ?? "", /^€20\.00$/);
    assert.match(doc.totals.find((row) => row.grand)?.value ?? "", /80\.00/);
  });

  it("обычный инвойс со скидкой — как раньше", () => {
    const doc = buildInvoiceDocument({
      ...input,
      creditNote: null,
      invoice: {
        ...note, number: "INV-1", notes: "", subtotal_net: 80, vat_amount: 0, vat_mode: "off", total: 80,
        lines: [line("a", "Чистка", 2, 50), line("d", "Скидка", 1, -20)],
      } as InvoiceLedgerWithLines,
    });
    assert.deepEqual(doc.lines.map((l) => l.title), ["Чистка"]);
    assert.match(doc.totals.find((row) => row.label === "Discount")?.value ?? "", /^[-−]€20\.00$/);
  });
});
