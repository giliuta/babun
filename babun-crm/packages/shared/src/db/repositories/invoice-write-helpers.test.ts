import { describe, expect, it } from "bun:test";
import { validateInvoiceDraft } from "./invoice-write-helpers";

const draft = {
  issued_on: "2026-07-20",
  due_on: "2026-07-30",
  vat_percent: 19,
  lines: [{ title: "Услуга", qty: 1, unit_price: 10 }],
};

describe("invoice write precision", () => {
  it("accepts cents and three-decimal quantities", () => {
    expect(
      validateInvoiceDraft({
        ...draft,
        lines: [{ title: "Материал", qty: 1.125, unit_price: 10.05 }],
      }),
    ).toEqual([{ title: "Материал", qty: 1.125, unit_price: 10.05 }]);
  });

  it("rejects a unit price that would be silently rounded", () => {
    expect(() =>
      validateInvoiceDraft({
        ...draft,
        lines: [{ title: "Услуга", qty: 1, unit_price: 10.005 }],
      }),
    ).toThrow("двух знаков");
  });

  it("rejects a VAT rate that would be silently rounded", () => {
    expect(() =>
      validateInvoiceDraft({ ...draft, vat_percent: 19.999 }),
    ).toThrow("двух знаков");
  });
});
