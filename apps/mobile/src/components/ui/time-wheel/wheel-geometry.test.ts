import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ITEM_H, MINUTES, outsideSafeRange, pad2, rowAt, wrapIndex } from "./wheel-geometry";

describe("wheel geometry", () => {
  test("minutes go in five-minute steps", () => {
    assert.equal(MINUTES.length, 12);
    assert.equal(MINUTES[0], "00");
    assert.equal(MINUTES[11], "55");
    assert.equal(pad2(7), "07");
  });

  test("wrapIndex keeps any absolute row inside one cycle", () => {
    assert.equal(wrapIndex(25, 24), 1);
    assert.equal(wrapIndex(-1, 24), 23);
    assert.equal(wrapIndex(0, 12), 0);
  });

  test("rowAt rounds the offset to the nearest row", () => {
    assert.equal(rowAt(ITEM_H * 3), 3);
    assert.equal(rowAt(ITEM_H * 3 + ITEM_H / 2 - 1), 3);
    assert.equal(rowAt(ITEM_H * 3 + ITEM_H / 2 + 1), 4);
  });

  test("the ribbon is recentred only outside one copy from either end", () => {
    // REPS = 7, a cycle of 24: safe rows are 24…143.
    assert.equal(outsideSafeRange(23, 24, 7), true);
    assert.equal(outsideSafeRange(24, 24, 7), false);
    assert.equal(outsideSafeRange(143, 24, 7), false);
    assert.equal(outsideSafeRange(144, 24, 7), true);
  });
});
