import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { scheduleWarning, sheetBandResolver, workBandResolver } from "./work-band";

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

describe("sheetBandResolver", () => {
  test("team band wins, day off passes through", () => {
    const band = { startMin: 600, endMin: 900 };
    const bandFor = sheetBandResolver((ymd) => (ymd === "off" ? null : band), 6, 22);
    assert.equal(bandFor("work"), band);
    assert.equal(bandFor("off"), null);
  });

  test("no team band — global hours, and without them no signal", () => {
    assert.deepEqual(sheetBandResolver(undefined, 8, 20)("2026-10-13"), {
      startMin: 480,
      endMin: 1200,
    });
    assert.equal(sheetBandResolver(() => undefined, undefined, 20)("2026-10-13"), undefined);
    assert.equal(sheetBandResolver(undefined, 8, null)("2026-10-13"), undefined);
  });
});

describe("scheduleWarning", () => {
  const band = { startMin: 540, endMin: 1080, breaks: [{ startMin: 780, endMin: 840 }] };

  test("day off, break, outside hours — in that order", () => {
    assert.equal(scheduleWarning(null, 600, 660), "Нерабочий день команды");
    assert.equal(scheduleWarning(band, 750, 800), "Попадает на перерыв");
    assert.equal(scheduleWarning(band, 480, 560), "Вне рабочих часов");
    assert.equal(scheduleWarning(band, 1050, 1110), "Вне рабочих часов");
  });

  test("inside hours, touching a break, or no band — no warning", () => {
    assert.equal(scheduleWarning(band, 600, 660), null);
    assert.equal(scheduleWarning(band, 720, 780), null);
    assert.equal(scheduleWarning(band, 840, 900), null);
    assert.equal(scheduleWarning(undefined, 0, 60), null);
    assert.equal(scheduleWarning({ startMin: 540, endMin: 1080 }, 600, 660), null);
  });
});
