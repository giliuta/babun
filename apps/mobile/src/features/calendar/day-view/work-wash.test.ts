import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { workWash } from "./work-wash";

const whole = { startHour: 0, endHour: 24, workStartHour: undefined, workEndHour: undefined };

describe("workWash", () => {
  test("team band wins and is kept for its breaks", () => {
    const band = { startMin: 540, endMin: 1080, breaks: [{ startMin: 780, endMin: 840 }] };
    const w = workWash({ ...whole, workBand: band, workStartHour: 7, workEndHour: 20 });
    assert.equal(w.band, band);
    assert.equal(w.workStart, 540);
    assert.equal(w.workEnd, 1080);
  });

  test("no band — global work hours, else the whole window", () => {
    assert.deepEqual(workWash({ ...whole, workBand: undefined, workStartHour: 8, workEndHour: 19 }), {
      band: { startMin: 480, endMin: 1140 },
      workStart: 480,
      workEnd: 1140,
    });
    const w = workWash({ ...whole, workBand: undefined });
    assert.equal(w.workStart, 0);
    assert.equal(w.workEnd, 1440);
  });

  test("day off — the whole column is washed by one band", () => {
    const w = workWash({ ...whole, workBand: null });
    assert.equal(w.band, null);
    assert.equal(w.workStart, 0);
    assert.equal(w.workEnd, 0);
  });

  test("band outside the visible window is clamped on both sides", () => {
    const w = workWash({ ...whole, startHour: 8, endHour: 18, workBand: { startMin: 300, endMin: 1300 } });
    assert.equal(w.workStart, 480);
    assert.equal(w.workEnd, 1080);
    const late = workWash({ ...whole, startHour: 8, endHour: 18, workBand: { startMin: 1200, endMin: 1300 } });
    assert.equal(late.workStart, 1080);
    assert.equal(late.workEnd, 1080);
  });
});
