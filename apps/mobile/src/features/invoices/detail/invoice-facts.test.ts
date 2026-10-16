import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { invoiceFacts } from "./invoice-facts";

const inv = { id: "i1", kind: "invoice", status: "issued", due_on: "2026-10-10", client_id: "c1", credit_note_of_id: null };
const note = { id: "n1", kind: "credit_note", status: "issued", due_on: null, client_id: "c1", credit_note_of_id: "i1" };

describe("invoiceFacts", () => {
  test("unpaid invoice past due waits for money and is overdue", () => {
    const f = invoiceFacts({ row: inv, all: [inv, note], stornoOfId: null, remaining: 50, businessToday: "2026-10-16" });
    assert.equal(f.awaitsPayment, true);
    assert.equal(f.isOverdue, true);
    assert.deepEqual(f.creditNotes, [note]);
    assert.equal(f.unassigned, false);
  });

  test("a credit note waits for nothing and points to its invoice", () => {
    const f = invoiceFacts({ row: note, all: [inv, note], stornoOfId: "i1", remaining: 50, businessToday: "2026-10-16" });
    assert.equal(f.isCreditNote, true);
    assert.equal(f.awaitsPayment, false);
    assert.equal(f.stornoOfInvoice, inv);
    assert.equal(f.unassigned, false);
  });

  test("void, settled and clientless invoices", () => {
    const base = { all: [], stornoOfId: null, businessToday: "2026-10-16" };
    assert.equal(invoiceFacts({ ...base, row: { ...inv, status: "void" }, remaining: 50 }).awaitsPayment, false);
    assert.equal(invoiceFacts({ ...base, row: inv, remaining: 0 }).isOverdue, false);
    assert.equal(invoiceFacts({ ...base, row: { ...inv, client_id: null }, remaining: 0 }).unassigned, true);
  });
});
