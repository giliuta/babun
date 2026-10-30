import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { workBandResolver } from "./work-band";

const schedule: TeamSchedule = {
  start: "09:00",
  end: "18:30",
  breaks: [
    { start: "13:00", end: "14:00" },
    { start: "garbage", end: "15:00" },
  ],
  date_overrides: {
    "2026-10-14": { is_working: false, start: "09:00", end: "18:00", breaks: [] },
    "2026-10-15": { is_working: true, start: "18:00", end: "09:00", breaks: [] },
  },
};

describe("workBandResolver", () => {
  test("no schedule — no resolver", () => {
    assert.equal(workBandResolver(undefined), undefined);
    assert.equal(workBandResolver(null), undefined);
  });

  test("working day: minutes and only the valid breaks", () => {
    const bandFor = workBandResolver(schedule);
    assert.deepEqual(bandFor?.("2026-10-13"), {
      startMin: 540,
      endMin: 1110,
      breaks: [{ startMin: 780, endMin: 840 }],
    });
  });

  test("day off is null, an unusable range is undefined", () => {
    const bandFor = workBandResolver(schedule);
    assert.equal(bandFor?.("2026-10-14"), null);
    assert.equal(bandFor?.("2026-10-15"), undefined);
  });
});
