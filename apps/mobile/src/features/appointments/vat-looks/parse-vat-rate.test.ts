import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseVatRate } from "./parse-vat-rate";

describe("ставка VAT из набранного", () => {
  test("пустое поле и пробелы не дают ставки: в память телефона нуль не уйдёт", () => {
    assert.equal(parseVatRate(""), null);
    assert.equal(parseVatRate("   "), null);
  });

  test("неразборчивое и вне диапазона — null", () => {
    assert.equal(parseVatRate("abc"), null);
    assert.equal(parseVatRate("-1"), null);
    assert.equal(parseVatRate("100"), null);
  });

  test("написанный рукой нуль остаётся нулём, запятая и точка одинаковы", () => {
    assert.equal(parseVatRate("0"), 0);
    assert.equal(parseVatRate("19"), 19);
    assert.equal(parseVatRate("5,5"), 5.5);
    assert.equal(parseVatRate("5.555"), 5.56);
  });
});
