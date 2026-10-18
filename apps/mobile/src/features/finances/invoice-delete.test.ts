import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InvoiceLedger } from "@babun/shared/local/finance/invoice-ledger";
import { deleteFreesNumber, invoiceDeleteBlock } from "./invoice-delete";

const inv = (seq: number, extra: Partial<InvoiceLedger> = {}) =>
  ({
    id: `i${seq}`,
    seq,
    year: 2026,
    company_id: "c1",
    status: "issued",
    kind: "invoice",
    credit_note_of_id: null,
    ...extra,
  }) as InvoiceLedger;

describe("invoiceDeleteBlock", () => {
  it("последний в серии без денег — можно", () => {
    const all = [inv(1), inv(2)];
    assert.equal(invoiceDeleteBlock(all[1]!, all, false), null);
  });
  it("из середины серии — нельзя, номер не освободить", () => {
    const all = [inv(1), inv(2)];
    assert.equal(invoiceDeleteBlock(all[0]!, all, false), "not-last");
  });
  it("серия своя у реквизитов и года", () => {
    const all = [inv(1), inv(5, { company_id: "c2" }), inv(7, { year: 2027 })];
    assert.equal(invoiceDeleteBlock(all[0]!, all, false), null);
  });
  it("с деньгами, оплаченный или с кредит-нотой — нельзя", () => {
    const all = [inv(1), inv(9, { id: "cn", kind: "credit_note", credit_note_of_id: "i1" })];
    assert.equal(invoiceDeleteBlock(inv(1), [inv(1)], true), "settled");
    assert.equal(invoiceDeleteBlock(inv(1, { status: "paid" }), [inv(1)], false), "settled");
    assert.equal(invoiceDeleteBlock(all[0]!, all, false), "settled");
    assert.equal(invoiceDeleteBlock(all[1]!, all, false), "not-invoice");
  });
});

// «НОМЕР ДОСТАНЕТСЯ СЛЕДУЮЩЕМУ» — ТОЛЬКО КОГДА ТАК И БУДЕТ. `delete_invoice`
// откатывает счётчик серии, лишь когда он стоит ровно на этом номере; ушёл
// дальше (номер руками подняли вперёд) — номер не вернётся, и обещать его
// нельзя.
describe("deleteFreesNumber", () => {
  it("счётчик на этом номере — номер вернётся", () => {
    assert.equal(deleteFreesNumber(inv(7), { seq: 8 }), true);
  });
  it("счётчик ушёл дальше — не вернётся", () => {
    assert.equal(deleteFreesNumber(inv(7), { seq: 104 }), false);
  });
  it("серию не узнать — не обещаем", () => {
    assert.equal(deleteFreesNumber(inv(7), null), false);
    assert.equal(deleteFreesNumber(inv(7, { company_id: null }), { seq: 8 }), false);
  });
});
