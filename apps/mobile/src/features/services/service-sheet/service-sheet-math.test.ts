import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  baseFieldErrors,
  firstServiceError,
  qtyOf,
  seedWeekdays,
  showCost,
  storeCost,
  toggleWeekday,
} from "./service-sheet-math";

describe("qtyOf", () => {
  test("parses a comma decimal", () => {
    assert.equal(qtyOf("2,5"), 2.5);
  });
  test("empty, zero and junk read as one", () => {
    assert.equal(qtyOf(""), 1);
    assert.equal(qtyOf("0"), 1);
    assert.equal(qtyOf("abc"), 1);
  });
});

describe("cost per unit vs per row", () => {
  test("unit mode shows and stores as typed", () => {
    assert.equal(showCost("5", 10, "unit"), "5");
    assert.equal(storeCost("50", 10, "unit"), "50");
  });
  test("total mode multiplies on show and divides on store", () => {
    assert.equal(showCost("5", 10, "total"), "50");
    assert.equal(storeCost("50", 10, "total"), "5");
    assert.equal(storeCost("10", 3, "total"), "3.33");
  });
  test("quantity one and empty input pass through", () => {
    assert.equal(showCost("5", 1, "total"), "5");
    assert.equal(storeCost("", 10, "total"), "");
  });
});

describe("weekdays", () => {
  test("seed keeps only ISO days", () => {
    assert.deepEqual(seedWeekdays([1, 0, 8, "3", 7]), [1, 7]);
    assert.deepEqual(seedWeekdays(null), []);
  });
  test("first tap on «any day» turns one day off", () => {
    assert.deepEqual(toggleWeekday([], 7), [1, 2, 3, 4, 5, 6]);
  });
  test("turning the last day back on means «any day» again", () => {
    assert.deepEqual(toggleWeekday([1, 2, 3, 4, 5, 6], 7), []);
  });
  test("days stay sorted", () => {
    assert.deepEqual(toggleWeekday([3, 5], 1), [1, 3, 5]);
  });
});

describe("baseFieldErrors", () => {
  test("empty price is free, zero time is allowed", () => {
    assert.deepEqual(baseFieldErrors("", "0"), {});
  });
  test("negative price and fractional time are errors", () => {
    assert.deepEqual(baseFieldErrors("-1", "1.5"), { price: "Цена от 0", duration: "Поставьте время" });
  });
  test("price above the column limit is an error, not a raw overflow", () => {
    assert.deepEqual(baseFieldErrors("10000000000", "60"), { price: "Цена не больше 9 999 999 999,99" });
    assert.deepEqual(baseFieldErrors("9999999999,99", "60"), {});
  });
});

describe("firstServiceError", () => {
  test("base errors come first", () => {
    assert.equal(firstServiceError({ duration: "d" }, { tiers: { a: { rowPrice: "p" } } }), "d");
  });
  test("a whole-row error is reachable", () => {
    assert.equal(firstServiceError({}, { tiers: { a: { row: "впишите цену или время" } } }), "впишите цену или время");
  });
  test("nothing — undefined", () => {
    assert.equal(firstServiceError({}, undefined), undefined);
  });
});
