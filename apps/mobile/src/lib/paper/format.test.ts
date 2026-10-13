import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatInvoiceMoney, parseMoneyAmount } from "./format";

describe("invoice money input", () => {
  it("accepts comma cents and rejects silent three-decimal rounding", () => {
    assert.equal(parseMoneyAmount("10,05"), 10.05);
    assert.equal(parseMoneyAmount("10.005"), null);
  });

  it("shares the product-wide parser: pasted symbols pass, numeric(12,2) cap holds", () => {
    // Сумму вставляют скопированной из сообщения — символ и пробелы не мешают.
    assert.equal(parseMoneyAmount("€1 234,50"), 1234.5);
    // Ноль легален (бесплатная строка), за него отвечает валидация итога.
    assert.equal(parseMoneyAmount("0"), 0);
    // За границей numeric(12,2) сервер откажет — парсер отказывает раньше.
    assert.equal(parseMoneyAmount("10000000000"), null);
  });
});

describe("invoice money display", () => {
  it("matches the app-wide EUR prefix convention", () => {
    assert.equal(formatInvoiceMoney(0), "€0");
    assert.equal(formatInvoiceMoney(1234.5), "€1\u00A0234,50");
    assert.equal(formatInvoiceMoney(-20), "−€20");
  });
});
