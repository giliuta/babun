import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customLineTotalText, unitPriceFromTotal } from "./custom-line";

describe("своя услуга в блоке: количество × цена ⇄ сумма", () => {
  it("quantity and unit price give the total", () => {
    assert.equal(customLineTotalText({ qty: "4", unitPrice: "50" }), "200,00");
  });

  it("the total gives the unit price", () => {
    assert.equal(unitPriceFromTotal("4", "300"), "75,00");
  });

  it("an uneven split is honest to the cent", () => {
    const price = unitPriceFromTotal("3", "100");
    assert.equal(price, "33,33");
    assert.equal(customLineTotalText({ qty: "3", unitPrice: price as string }), "99,99");
  });

  it("empty or zero quantity leaves the price alone", () => {
    assert.equal(unitPriceFromTotal("", "100"), null);
    assert.equal(unitPriceFromTotal("0", "100"), null);
    assert.equal(customLineTotalText({ qty: "2", unitPrice: "" }), "");
  });
});
