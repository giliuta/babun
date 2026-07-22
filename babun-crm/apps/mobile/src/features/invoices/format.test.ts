import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatInvoiceMoney, parseMoneyAmount } from "./format";

describe("invoice money input", () => {
  it("accepts comma cents and rejects silent three-decimal rounding", () => {
    assert.equal(parseMoneyAmount("10,05"), 10.05);
    assert.equal(parseMoneyAmount("10.005"), null);
  });
});

describe("invoice money display", () => {
  it("matches the app-wide EUR prefix convention", () => {
    assert.equal(formatInvoiceMoney(0), "€0");
    assert.equal(formatInvoiceMoney(1234.5), "€1\u00A0234,50");
    assert.equal(formatInvoiceMoney(-20), "−€20");
  });
});
