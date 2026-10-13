import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { recordTotals, totalDraftText, typedDiscount, type RecordTotalsInput } from "./book-money";

describe("typedDiscount", () => {
  test("no number typed — no discount, whatever the unit", () => {
    assert.equal(typedDiscount("percent", "", null), null);
    assert.equal(typedDiscount("fixed", "0", "loyalty"), null);
  });

  test("a typed number is a discount in the chosen unit (euro by default)", () => {
    assert.deepEqual(typedDiscount(null, "5", null), { type: "fixed", value: 5, reason: undefined });
    assert.deepEqual(typedDiscount("percent", "10", "old"), { type: "percent", value: 10, reason: "old" });
  });
});

const totals = (over: Partial<RecordTotalsInput> = {}) =>
  recordTotals({
    computedTotal: 100,
    discountAmount: 0,
    recordVatMode: "none",
    vatRateInUse: 19,
    customTotal: false,
    totalDraft: "",
    ...over,
  });

describe("recordTotals", () => {
  test("services minus discount, never below zero, rounded to the cent", () => {
    assert.deepEqual(totals({ computedTotal: 22.51, discountAmount: 0.001 }), {
      beforeVat: 22.51,
      automaticTotal: 22.51,
      effectiveTotal: 22.51,
    });
    assert.equal(totals({ discountAmount: 150 }).beforeVat, 0);
  });

  test("exclusive VAT is added on top; a zero rate changes nothing", () => {
    assert.equal(totals({ recordVatMode: "exclusive" }).automaticTotal, 119);
    assert.equal(totals({ recordVatMode: "exclusive", vatRateInUse: 0 }).automaticTotal, 100);
    assert.equal(totals({ recordVatMode: "inclusive" }).automaticTotal, 100);
  });

  test("a custom total wins over the computed one", () => {
    const out = totals({ customTotal: true, totalDraft: "49,5", recordVatMode: "exclusive" });
    assert.equal(out.effectiveTotal, 49.5);
    assert.equal(out.automaticTotal, 119);
  });
});

describe("totalDraftText", () => {
  test("whole euros without decimals, cents always with two", () => {
    assert.equal(totalDraftText(50), "50");
    assert.equal(totalDraftText(49.5), "49.50");
  });
});
