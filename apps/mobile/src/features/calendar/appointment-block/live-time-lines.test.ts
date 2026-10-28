import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { liveTimeLines } from "./live-time-lines";

describe("liveTimeLines", () => {
  test("время одной строкой — как есть", () => {
    assert.deepEqual(liveTimeLines("15:30"), ["15:30"]);
  });
  test("перенос на другой день — день над временем", () => {
    assert.deepEqual(liveTimeLines("Сб 31 15:30"), ["Сб 31", "15:30"]);
  });
  test("растяжка — начало над концом, время не рвётся", () => {
    assert.deepEqual(liveTimeLines("15:30–17:00"), ["15:30–", "17:00"]);
  });
});
