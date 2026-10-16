import assert from "node:assert/strict";
import { test } from "node:test";
import { unitFromRowTotal } from "./line-math";

test("a typed row sum is divided back into the unit price, in cents", () => {
  assert.equal(unitFromRowTotal(100, 3), 33.33);
  assert.equal(unitFromRowTotal(270, 2), 135);
});

test("quantity below one counts as one", () => {
  assert.equal(unitFromRowTotal(50, 0), 50);
});
