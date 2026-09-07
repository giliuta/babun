import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { shiftRangeStart } from "./time-range";

describe("shiftRangeStart", () => {
  test("keeps the duration when the start moves later", () => {
    assert.deepEqual(shiftRangeStart("13:00", "16:15", "15:00"), {
      timeStart: "15:00",
      timeEnd: "18:15",
    });
  });

  test("keeps the duration when the start moves earlier", () => {
    assert.deepEqual(shiftRangeStart("13:00", "13:30", "09:05"), {
      timeStart: "09:05",
      timeEnd: "09:35",
    });
  });

  test("falls back to an hour when the stored range is empty or reversed", () => {
    assert.equal(shiftRangeStart("13:00", "13:00", "14:00").timeEnd, "15:00");
    assert.equal(shiftRangeStart("13:00", "12:00", "14:00").timeEnd, "15:00");
  });

  test("stops at the end of the day instead of wrapping past midnight", () => {
    assert.deepEqual(shiftRangeStart("10:00", "13:00", "22:30"), {
      timeStart: "22:30",
      timeEnd: "23:59",
    });
  });
});
