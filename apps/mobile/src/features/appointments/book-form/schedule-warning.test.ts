import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { scheduleWarning, type ScheduleWarningInput } from "./schedule-warning";

// 2026-10-05 is a Monday.
const MONDAY = "2026-10-05";

const schedule: TeamSchedule = {
  start: "09:00",
  end: "18:00",
  breaks: [{ start: "13:00", end: "14:00" }],
  overrides: { sun: { is_working: false, start: "09:00", end: "18:00", breaks: [] } },
};

const input = (over: Partial<ScheduleWarningInput> = {}): ScheduleWarningInput => ({
  editId: null,
  teamId: "t1",
  date: MONDAY,
  timeStart: "10:00",
  timeEnd: "11:00",
  schedule,
  calendarSettings: DEFAULT_CALENDAR_SETTINGS,
  teams: [{ id: "t1", buffer_minutes: null }],
  dayTeamAppts: [],
  ...over,
});

describe("scheduleWarning", () => {
  test("a personal event (no team) never warns", () => {
    assert.equal(scheduleWarning(input({ teamId: null, timeStart: "03:00" })), null);
  });

  test("inside the team's hours and away from breaks — silent", () => {
    assert.equal(scheduleWarning(input()), null);
  });

  test("the team's day off", () => {
    assert.equal(
      scheduleWarning(input({ date: "2026-10-11" })),
      "У команды нерабочий день",
    );
  });

  test("outside the team's hours names them", () => {
    assert.equal(
      scheduleWarning(input({ timeStart: "08:00", timeEnd: "09:30" })),
      "Вне графика команды 09:00–18:00",
    );
  });

  test("touching the break", () => {
    assert.equal(
      scheduleWarning(input({ timeStart: "12:30", timeEnd: "13:30" })),
      "Время попадает на перерыв команды",
    );
    // Ending exactly when the break starts is fine.
    assert.equal(scheduleWarning(input({ timeStart: "12:00", timeEnd: "13:00" })), null);
  });

  test("without a team schedule the company working hours apply", () => {
    const settings = { ...DEFAULT_CALENDAR_SETTINGS, workStartHour: 8, workEndHour: 17 };
    assert.equal(
      scheduleWarning(input({ schedule: null, calendarSettings: settings, timeEnd: "17:30" })),
      "Вне общих рабочих часов",
    );
    assert.equal(
      scheduleWarning(input({ schedule: undefined, calendarSettings: settings })),
      null,
    );
  });

  test("too little road time to the team's neighbour record", () => {
    const neighbour = createBlankAppointment({
      id: "other",
      kind: "work",
      team_id: "t1",
      date: MONDAY,
      time_start: "11:10",
      time_end: "12:00",
    });
    const tight = input({
      teams: [{ id: "t1", buffer_minutes: 30 }],
      dayTeamAppts: [neighbour],
    });
    assert.equal(scheduleWarning(tight), "Между записями меньше 30 мин на дорогу");
    // No buffer configured — nothing to say.
    assert.equal(scheduleWarning({ ...tight, teams: [{ id: "t1", buffer_minutes: 0 }] }), null);
  });
});
