import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { InvoiceLineDraft } from "@babun/shared/local/finance/invoice-ledger";
import type { EditableInvoiceLine } from "@/lib/paper/format";
import {
  appointmentVatOf,
  discountAmountOf,
  existingDiscountOf,
  incomeAmountOf,
  initialInvoiceVatMode,
  invoiceReason,
  rolledIssueDates,
} from "./invoice-rules";

const here = dirname(fileURLToPath(import.meta.url));

describe("what the source visit and income bring", () => {
  test("only a visit with an inclusive/exclusive rate passes its tax on", () => {
    assert.deepEqual(appointmentVatOf({ vat_mode: "exclusive", vat_rate: 19 }), { mode: "exclusive", rate: 19 });
    assert.deepEqual(appointmentVatOf({ vat_mode: "inclusive", vat_rate: 5 }), { mode: "inclusive", rate: 5 });
    assert.equal(appointmentVatOf({ vat_mode: "exclusive", vat_rate: 0 }), null);
    assert.equal(appointmentVatOf({ vat_mode: "none", vat_rate: 19 }), null);
    assert.equal(appointmentVatOf(null), null);
  });

  test("an income amount counts only with its transaction", () => {
    assert.equal(incomeAmountOf({ transactionId: "tx", amount: 47.005 }), 47.01);
    assert.equal(incomeAmountOf({ transactionId: "tx", amount: 0 }), null);
    assert.equal(incomeAmountOf({ amount: 47 }), null);
    assert.equal(incomeAmountOf(undefined), null);
  });

  test("an issued invoice's discount is its negative lines", () => {
    assert.equal(
      existingDiscountOf({ lines: [{ unit_price: 100, qty: 2 }, { unit_price: -15.5, qty: 1 }] }),
      15.5,
    );
    assert.equal(existingDiscountOf({ lines: [{ unit_price: 10, qty: 1 }] }), 0);
    assert.equal(existingDiscountOf(null), 0);
  });
});

describe("initialInvoiceVatMode", () => {
  const base = {
    existing: null,
    incomeAmount: null,
    hasSourceAppointment: false,
    appointmentVat: null,
    seedVatMode: "exclusive" as const,
    seeded: false,
  };

  test("a new invoice follows the team setting", () => {
    assert.equal(initialInvoiceVatMode(base), "exclusive");
  });

  test("the visit's tax wins over the team's", () => {
    assert.equal(
      initialInvoiceVatMode({ ...base, hasSourceAppointment: true, appointmentVat: { mode: "inclusive", rate: 19 } }),
      "inclusive",
    );
  });

  test("money of a visit without tax is invoiced without tax", () => {
    assert.equal(initialInvoiceVatMode({ ...base, incomeAmount: 47, hasSourceAppointment: true }), "off");
  });

  test("received money already holds the tax: «on top» becomes «inside»", () => {
    assert.equal(initialInvoiceVatMode({ ...base, incomeAmount: 47 }), "inclusive");
    assert.equal(initialInvoiceVatMode({ ...base, incomeAmount: 47, seeded: true }), "exclusive");
    assert.equal(initialInvoiceVatMode({ ...base, incomeAmount: 47, seedVatMode: "off" }), "off");
  });
});

describe("discountAmountOf", () => {
  test("percent and fixed, comma decimals, nonsense is zero", () => {
    assert.equal(discountAmountOf(200, "percent", "10"), 20);
    assert.equal(discountAmountOf(200, "fixed", "12,5"), 12.5);
    assert.equal(discountAmountOf(200, "fixed", "500"), 200);
    assert.equal(discountAmountOf(200, "fixed", ""), 0);
    assert.equal(discountAmountOf(200, "percent", "abc"), 0);
    assert.equal(discountAmountOf(200, "percent", "-5"), 0);
  });
});

describe("invoiceReason", () => {
  const line = (over: Partial<EditableInvoiceLine> = {}): EditableInvoiceLine => ({
    id: "l1",
    title: "Service",
    qty: "1",
    unitPrice: "100",
    serviceId: "s1",
    ...over,
  });
  const parsed = (over: Partial<InvoiceLineDraft> = {}): InvoiceLineDraft => ({
    title: "Service",
    qty: 1,
    unit_price: 100,
    ...over,
  });
  const company = {
    is_default: true,
    archived_at: null,
    legal_name: "Babun Ltd",
    vat_number: "CY123",
    business_address: "Limassol",
  };
  const ready = {
    lines: [line()],
    parsedLines: [parsed()],
    total: 100,
    rate: 19,
    incomeAmount: null,
    currency: "EUR",
    owner: true,
    companiesLoaded: true,
    pickedCompany: company,
    vatMode: "exclusive" as const,
  };

  test("a complete invoice has no reason", () => {
    assert.equal(invoiceReason(ready), null);
  });

  test("empty lines are hints, broken lines are errors", () => {
    const empty = invoiceReason({ ...ready, parsedLines: [parsed({ title: "", unit_price: -1 })], total: 0 });
    assert.equal(empty?.error, false);
    const noPrice = invoiceReason({ ...ready, parsedLines: [parsed({ unit_price: -1 })], total: 0 });
    assert.equal(noPrice?.error, false);
    assert.notEqual(noPrice?.text, empty?.text);
    const typing = invoiceReason({ ...ready, lines: [line({ serviceId: null, title: " " })] });
    assert.equal(typing?.error, false);
    const broken = invoiceReason({ ...ready, parsedLines: [parsed(), parsed({ qty: 0 })] });
    assert.equal(broken?.error, true);
  });

  test("rate out of range, zero total, income mismatch are errors", () => {
    assert.equal(invoiceReason({ ...ready, rate: 101 })?.error, true);
    assert.equal(invoiceReason({ ...ready, parsedLines: [parsed(), parsed({ unit_price: -1 })], lines: [line()], total: 0 })?.error, true);
    const mismatch = invoiceReason({ ...ready, incomeAmount: 90 });
    assert.equal(mismatch?.error, true);
    assert.equal(invoiceReason({ ...ready, incomeAmount: 100 }), null);
  });

  test("the owner is sent to the requisites; a partner is not judged", () => {
    const blank = { ...company, legal_name: null, vat_number: null, business_address: null };
    assert.equal(invoiceReason({ ...ready, pickedCompany: blank })?.error, false);
    assert.equal(invoiceReason({ ...ready, pickedCompany: null })?.error, false);
    assert.equal(invoiceReason({ ...ready, pickedCompany: null, companiesLoaded: false }), null);
    assert.equal(invoiceReason({ ...ready, pickedCompany: blank, owner: false }), null);
  });

  test("VAT needs a VAT number, but only when VAT is charged", () => {
    const noVat = { ...company, vat_number: " " };
    assert.equal(invoiceReason({ ...ready, pickedCompany: noVat })?.error, false);
    assert.equal(invoiceReason({ ...ready, pickedCompany: noVat, vatMode: "off" }), null);
    assert.equal(invoiceReason({ ...ready, pickedCompany: noVat, rate: 0 }), null);
  });
});

// ДАТА ВЫСТАВЛЕНИЯ ЕДЕТ ЗА ЧАСАМИ, ПОКА ЕЁ НЕ ТРОГАЛИ РУКАМИ: форму открыли
// 31.12 в 23:50, «Выставить» — в 00:10.
describe("дата выставления в миг выставления", () => {
  const base = {
    issuedOn: "2026-12-31",
    dueOn: "2027-01-07",
    issuedTouched: false,
    dueTouched: false,
  };

  test("не трогали — после полуночи документ выходит новым днём и годом, срок держит отступ", () => {
    assert.deepEqual(rolledIssueDates({ ...base, today: "2027-01-01" }), {
      issuedOn: "2027-01-01",
      dueOn: "2027-01-08",
    });
  });

  test("тот же день — ничего не меняется", () => {
    assert.deepEqual(rolledIssueDates({ ...base, today: "2026-12-31" }), {
      issuedOn: "2026-12-31",
      dueOn: "2027-01-07",
    });
  });

  test("дату выбрали руками — остаётся выбранной, хоть полночь прошла", () => {
    assert.deepEqual(
      rolledIssueDates({ ...base, issuedTouched: true, issuedOn: "2026-12-30", today: "2027-01-01" }),
      { issuedOn: "2026-12-30", dueOn: "2027-01-07" },
    );
  });

  test("срок выбрали руками — остаётся, но не раньше новой даты", () => {
    assert.deepEqual(
      rolledIssueDates({ ...base, dueTouched: true, dueOn: "2027-01-15", today: "2027-01-01" }),
      { issuedOn: "2027-01-01", dueOn: "2027-01-15" },
    );
    assert.deepEqual(
      rolledIssueDates({ ...base, dueTouched: true, dueOn: "2027-01-01", today: "2027-01-03" }),
      { issuedOn: "2027-01-03", dueOn: "2027-01-03" },
    );
  });

  // СЕРВЕР НЕ ВЫСТАВЛЯЕТ ДОКУМЕНТ БУДУЩИМ ЧИСЛОМ (`issue_invoice`: «Документ
  // нельзя датировать будущим числом»): нетронутая дата — всегда сегодня, даже
  // у счёта по визиту на следующей неделе.
  test("нетронутая будущая дата сходит на сегодня", () => {
    assert.deepEqual(
      rolledIssueDates({ ...base, issuedOn: "2027-02-01", dueOn: null, today: "2027-01-01" }),
      { issuedOn: "2027-01-01", dueOn: null },
    );
  });

  test("новый счёт рождается сегодняшним днём, а не днём визита", () => {
    const draft = readFileSync(resolve(here, "use-invoice-draft.ts"), "utf8");
    assert.match(draft, /useState\(existing\?\.issued_on \?\? businessToday\)/);
    assert.doesNotMatch(draft, /seed\?\.issuedOn|prefill\?\.issuedOn/);
  });

  test("барабан «Выставлен» не крутится дальше сегодня", () => {
    const block = readFileSync(resolve(here, "../InvoiceDatesBlock.tsx"), "utf8");
    assert.match(
      block,
      /value=\{parseYMD\(draftIssued\)\}\s*maximumDate=\{parseYMD\(today\)\}/,
    );
    const blocks = readFileSync(resolve(here, "../InvoiceBlocks.tsx"), "utf8");
    assert.match(blocks, /<InvoiceDatesBlock[^>]*today=\{today\}/);
    const editor = readFileSync(resolve(here, "../InvoiceEditor.tsx"), "utf8");
    assert.match(editor, /today=\{businessToday\}/);
  });

  test("редактор берёт даты на момент выставления, а черновик не считает сдвиг правкой", () => {
    const editor = readFileSync(resolve(here, "../InvoiceEditor.tsx"), "utf8");
    assert.match(editor, /const dates = datesAt\(currentBusinessToday\?\.\(\) \?\? businessToday\);/);
    assert.match(editor, /issued_on: dates\.issuedOn,\s*due_on: dates\.dueOn,/);
    const paper = readFileSync(resolve(here, "use-invoice-paper.ts"), "utf8");
    assert.match(paper, /issuedOn: issuedTouched\.current \? issuedOn : null,/);
    const page = readFileSync(resolve(here, "../../../../app/invoices/new.tsx"), "utf8");
    assert.match(page, /currentBusinessToday=\{\(\) =>/);
  });
});
