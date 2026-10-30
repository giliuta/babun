import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatYMD } from "@/features/appointments/helpers";
import {
  addDays,
  parseHourHM,
  repeatExpandAnchor,
  repeatExpandWindow,
  startOfDay,
  startOfMonth,
} from "./dates";

describe("local date helpers", () => {
  test("startOfDay and startOfMonth snap to local midnight", () => {
    const d = new Date(2026, 9, 13, 17, 45, 12);
    assert.deepEqual(startOfDay(d), new Date(2026, 9, 13));
    assert.deepEqual(startOfMonth(d), new Date(2026, 9, 1));
  });

  test("addDays drops the time of day and crosses month and year ends", () => {
    assert.deepEqual(addDays(new Date(2026, 9, 13, 23, 30), 1), new Date(2026, 9, 14));
    assert.deepEqual(addDays(new Date(2026, 9, 31), 1), new Date(2026, 10, 1));
    assert.deepEqual(addDays(new Date(2027, 0, 1), -1), new Date(2026, 11, 31));
    assert.deepEqual(addDays(new Date(2026, 9, 13), 0), new Date(2026, 9, 13));
  });

  test("parseHourHM reads HH:MM as fractional hours and rejects garbage", () => {
    assert.equal(parseHourHM("08:30"), 8.5);
    assert.equal(parseHourHM("9:15"), 9.25);
    assert.equal(parseHourHM("24:00"), 24);
    assert.equal(parseHourHM("24:30"), null);
    assert.equal(parseHourHM("утро"), null);
    assert.equal(parseHourHM(""), null);
    assert.equal(parseHourHM(null), null);
    assert.equal(parseHourHM(undefined), null);
  });
});

describe("repeat expansion window", () => {
  test("month view anchors on the 1st of the month", () => {
    assert.equal(repeatExpandAnchor(new Date(2026, 9, 13), true), "2026-10-01");
  });

  test("other views keep one anchor for a whole 28-day bucket", () => {
    const anchor = repeatExpandAnchor(new Date(2026, 9, 13), false);
    const [y, m, d] = anchor.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    for (let i = 0; i < 28; i++) {
      assert.equal(repeatExpandAnchor(addDays(start, i), false), anchor, `day ${i}`);
    }
    assert.notEqual(repeatExpandAnchor(addDays(start, 28), false), anchor);
    assert.notEqual(repeatExpandAnchor(addDays(start, -1), false), anchor);
  });

  test("the bucket window still covers −30…+60 days of any day in it", () => {
    const day = new Date(2026, 9, 13);
    const anchor = repeatExpandAnchor(day, false);
    const { fromKey, toKey } = repeatExpandWindow(anchor, false);
    assert.ok(fromKey <= formatYMD(addDays(day, -30)));
    assert.ok(toKey >= formatYMD(addDays(day, 60)));
  });

  test("month window spans the neighbouring months plus week tails", () => {
    assert.deepEqual(repeatExpandWindow("2026-10-01", true), {
      fromKey: "2026-08-25",
      toKey: "2026-12-07",
    });
    assert.deepEqual(repeatExpandWindow("2026-10-01", false), {
      fromKey: "2026-08-27",
      toKey: "2026-12-30",
    });
  });
});
