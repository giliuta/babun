import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { slotTimeAt, TAP_STEP } from "./slot-time";

describe("slotTimeAt", () => {
  const hourH = 60;

  test("tap snaps down to the half hour", () => {
    assert.equal(TAP_STEP, 30);
    assert.equal(slotTimeAt(11, 27, hourH), "11:00");
    assert.equal(slotTimeAt(11, 40, hourH), "11:30");
    assert.equal(slotTimeAt(13, 45, hourH), "13:30");
  });

  test("no coordinates (screen reader) — the whole hour", () => {
    assert.equal(slotTimeAt(9, 0, hourH), "09:00");
  });

  test("offset is clamped inside the hour cell", () => {
    assert.equal(slotTimeAt(9, -10, hourH), "09:00");
    assert.equal(slotTimeAt(9, 200, hourH), "09:30");
  });

  test("uses the committed hour height", () => {
    assert.equal(slotTimeAt(8, 60, 120), "08:30");
    assert.equal(slotTimeAt(8, 59, 120), "08:00");
  });
});
