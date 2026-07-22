import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cashCentsToInput,
  parseCashInputToCents,
} from "./day-closure-money";

describe("day closure cash cents", () => {
  test("parses dot and comma input without floating point drift", () => {
    assert.equal(parseCashInputToCents("12.34"), 1234);
    assert.equal(parseCashInputToCents("12,3"), 1230);
    assert.equal(parseCashInputToCents("0"), 0);
  });

  test("rejects negatives, excessive precision and malformed input", () => {
    assert.equal(parseCashInputToCents("-1"), null);
    assert.equal(parseCashInputToCents("1.001"), null);
    assert.equal(parseCashInputToCents("1,2.3"), null);
    assert.equal(parseCashInputToCents(""), null);
  });

  test("formats canonical cents for the exact-fill action", () => {
    assert.equal(cashCentsToInput(1234), "12.34");
    assert.equal(cashCentsToInput(1200), "12");
    assert.equal(cashCentsToInput(-100), "0");
  });
});
