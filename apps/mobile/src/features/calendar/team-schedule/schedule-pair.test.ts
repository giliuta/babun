import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { withDay } from "../schedule-days";
import { hm, pairOnEnd, pairOnStart, sameHoursEveryDay, text } from "./schedule-pair";

describe("schedule pair", () => {
  test("hm and text round-trip", () => {
    assert.deepEqual(hm("09:05"), { hour: 9, minute: 5 });
    assert.equal(text({ hour: 7, minute: 0 }), "07:00");
  });

  test("moving the start keeps the end, unless it would overtake it", () => {
    assert.deepEqual(pairOnStart({ start: "09:00", end: "18:00" }, { hour: 10 }), { start: "10:00", end: "18:00" });
    assert.deepEqual(pairOnStart({ start: "09:00", end: "18:00" }, { hour: 19 }), { start: "19:00", end: "19:05" });
  });

  test("moving the end keeps the start, unless it would fall behind it", () => {
    assert.deepEqual(pairOnEnd({ start: "09:00", end: "18:00" }, { hour: 17 }), { start: "09:00", end: "17:00" });
    assert.deepEqual(pairOnEnd({ start: "09:00", end: "18:00" }, { hour: 8 }), { start: "07:55", end: "08:00" });
  });

  test("a wheel wrapped through midnight sticks to the edge of the day", () => {
    assert.deepEqual(pairOnEnd({ start: "09:00", end: "23:30" }, { hour: 0 }), { start: "09:00", end: "23:55" });
    assert.deepEqual(pairOnStart({ start: "00:30", end: "18:00" }, { hour: 23 }), { start: "00:00", end: "18:00" });
  });
});

describe("sameHoursEveryDay", () => {
  test("no schedule reads as one set of hours", () => {
    assert.equal(sameHoursEveryDay(null), true);
  });

  test("a weekday with its own hours breaks the common view", () => {
    const base: TeamSchedule = { start: "09:00", end: "18:00", breaks: [] };
    assert.equal(sameHoursEveryDay(base), true);
    const differs = withDay(base, "sat", { start: "10:00", end: "15:00" });
    assert.equal(sameHoursEveryDay(differs), false);
  });
});
