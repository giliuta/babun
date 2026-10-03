import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dueDayOptions } from "./due-days";

describe("dueDayOptions", () => {
  test("набор: по факту, 7, 14, 30", () => {
    assert.deepEqual(
      dueDayOptions(7).map((o) => o.label),
      ["По факту", "7", "14", "30"],
    );
  });

  test("срок вне набора виден своей клавишей по порядку", () => {
    assert.deepEqual(
      dueDayOptions(10).map((o) => o.value),
      ["0", "7", "10", "14", "30"],
    );
  });
});
