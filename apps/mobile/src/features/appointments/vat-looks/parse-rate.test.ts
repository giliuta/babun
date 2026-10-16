import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseVatRate } from "./parse-rate";

describe("parseVatRate", () => {
  test("стёртое поле — не ставка: ни применять, ни запоминать нечего", () => {
    // Number("") === 0: пустая строка проходила как «0 %», запоминалась, и
    // строка VAT пропадала посреди набора новой ставки.
    assert.equal(parseVatRate(""), null);
    assert.equal(parseVatRate("   "), null);
  });

  test("неразборчивое ждёт следующего символа", () => {
    assert.equal(parseVatRate(","), null);
    assert.equal(parseVatRate("."), null);
    assert.equal(parseVatRate("abc"), null);
  });

  test("набранный ноль — честный ноль", () => {
    assert.equal(parseVatRate("0"), 0);
  });

  test("запятая и точка одинаковы, два знака, 0…99.99", () => {
    assert.equal(parseVatRate("19"), 19);
    assert.equal(parseVatRate("5,5"), 5.5);
    assert.equal(parseVatRate("7.125"), 7.13);
    assert.equal(parseVatRate("100"), null);
    assert.equal(parseVatRate("-1"), null);
  });
});
