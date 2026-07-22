import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  beginCalendarSave,
  confirmCalendarSave,
  createCalendarSaveState,
  currentCalendarSaveValue,
  rejectCalendarSave,
} from "./calendar-save-state";

describe("calendar settings optimistic saves", () => {
  test("rejecting one request preserves a later pending tap", () => {
    const state = createCalendarSaveState("tenant:owner", {
      ...DEFAULT_CALENDAR_SETTINGS,
      startHour: 6,
    });
    const first = beginCalendarSave(state, { startHour: 7 });
    const second = beginCalendarSave(state, { startHour: 8 });

    rejectCalendarSave(state, first);
    assert.equal(currentCalendarSaveValue(state).startHour, 8);

    confirmCalendarSave(
      state,
      second,
      { ...DEFAULT_CALENDAR_SETTINGS, startHour: 8 },
    );
    assert.equal(currentCalendarSaveValue(state).startHour, 8);
    assert.equal(state.pending.size, 0);
  });

  test("rejecting every request restores the last confirmed value", () => {
    const state = createCalendarSaveState("tenant:owner", {
      ...DEFAULT_CALENDAR_SETTINGS,
      gridStep: 30,
    });
    const first = beginCalendarSave(state, { gridStep: 15 });
    const second = beginCalendarSave(state, { gridStep: 60 });

    rejectCalendarSave(state, second);
    rejectCalendarSave(state, first);

    assert.equal(currentCalendarSaveValue(state).gridStep, 30);
    assert.equal(state.pending.size, 0);
  });
});
