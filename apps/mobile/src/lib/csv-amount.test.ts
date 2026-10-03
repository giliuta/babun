import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { csvAmount } from "./csv-amount";

describe("сумма в CSV", () => {
  test("число с десятичной запятой и знаком, копейки без дребезга", () => {
    assert.equal(csvAmount(55), "55,00");
    assert.equal(csvAmount(-55.5), "-55,50");
    assert.equal(csvAmount(0.1 + 0.2), "0,30");
    assert.equal(csvAmount(null), "");
  });
});
