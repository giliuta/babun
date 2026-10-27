import assert from "node:assert/strict";
import { test } from "node:test";
import { clampedDiscountText, unitFromRowTotal } from "./line-math";

test("a typed row sum is divided back into the unit price, in cents", () => {
  assert.equal(unitFromRowTotal(100, 3), 33.33);
  assert.equal(unitFromRowTotal(270, 2), 135);
});

test("quantity below one counts as one", () => {
  assert.equal(unitFromRowTotal(50, 0), 50);
});

test("a fixed discount above the work sum is cut to the sum, in cents", () => {
  assert.equal(clampedDiscountText(200, false, 140), "140");
  assert.equal(clampedDiscountText(50, false, 49.5), "49.50");
  assert.equal(clampedDiscountText(10, false, 0), "0");
});

test("a percent discount stops at 100 whatever the sum", () => {
  assert.equal(clampedDiscountText(150, true, 40), "100");
  assert.equal(clampedDiscountText(100, true, 40), null);
});

test("a discount within the sum leaves the field alone", () => {
  assert.equal(clampedDiscountText(140, false, 140), null);
  assert.equal(clampedDiscountText(0, false, 140), null);
});
