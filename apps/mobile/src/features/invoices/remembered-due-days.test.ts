import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FIRST_INVOICE_DUE_DAYS, rememberedDueDays } from "./due-days";

const doc = (over: Partial<Parameters<typeof rememberedDueDays>[0] extends readonly (infer T)[] | undefined ? T : never>) => ({
  kind: "invoice",
  created_by: "me",
  created_at: "2026-10-01T10:00:00Z",
  issued_on: "2026-10-01",
  due_on: "2026-10-31",
  ...over,
});

// Владелец 2026-10-03: стандарт 30, дальше — как на прошлом своём инвойсе.
describe("rememberedDueDays", () => {
  it("starts at 30 days before the first invoice", () => {
    assert.equal(rememberedDueDays([], "me"), FIRST_INVOICE_DUE_DAYS);
    assert.equal(FIRST_INVOICE_DUE_DAYS, 30);
  });

  it("repeats the term of my latest invoice, and follows when I change it back", () => {
    const seven = doc({ created_at: "2026-10-02T09:00:00Z", issued_on: "2026-10-02", due_on: "2026-10-09" });
    assert.equal(rememberedDueDays([doc({}), seven], "me"), 7);
    const thirtyAgain = doc({ created_at: "2026-10-03T09:00:00Z", issued_on: "2026-10-03", due_on: "2026-11-02" });
    assert.equal(rememberedDueDays([doc({}), seven, thirtyAgain], "me"), 30);
  });

  it("ignores other people's invoices and credit notes", () => {
    const theirs = doc({ created_by: "partner", created_at: "2026-10-05T00:00:00Z", due_on: "2026-10-15" });
    const credit = doc({ kind: "credit_note", created_at: "2026-10-06T00:00:00Z", due_on: "2026-10-01" });
    assert.equal(rememberedDueDays([doc({}), theirs, credit], "me"), 30);
  });

  it("keeps «по факту» (0 days)", () => {
    assert.equal(rememberedDueDays([doc({ due_on: "2026-10-01" })], "me"), 0);
  });
});
