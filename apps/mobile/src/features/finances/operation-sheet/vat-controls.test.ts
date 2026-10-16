import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { vatControlsVisible } from "./vat-controls";

describe("клавиши VAT в листе операции", () => {
  test("открытая строка не пропадает, когда в поле ставки ноль", () => {
    assert.equal(vatControlsVisible({ isOwner: true, rate: 0, shown: true }), true);
  });

  test("закрытая при нулевой ставке — скрыта, как и раньше", () => {
    assert.equal(vatControlsVisible({ isOwner: true, rate: 0, shown: false }), false);
    assert.equal(vatControlsVisible({ isOwner: true, rate: 19, shown: false }), true);
  });

  test("сотруднику налог не показывается никогда", () => {
    assert.equal(vatControlsVisible({ isOwner: false, rate: 19, shown: true }), false);
  });
});
