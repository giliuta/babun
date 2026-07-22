import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { rescheduleWarning } from "./reschedule-warning";

const target = createBlankAppointment({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "work",
  team_id: "team-a",
  date: "2026-07-20",
  time_start: "10:00",
  time_end: "11:00",
});
const neighbor = createBlankAppointment({
  id: "00000000-0000-4000-8000-000000000002",
  kind: "work",
  team_id: "team-a",
  date: "2026-07-21",
  time_start: "12:00",
  time_end: "13:00",
});

describe("rescheduleWarning", () => {
  test("prioritizes overlap over schedule and buffer", () => {
    assert.equal(
      rescheduleWarning(
        target,
        { date: neighbor.date, timeStart: "12:30", timeEnd: "13:30" },
        [target, neighbor],
        null,
        30,
      ),
      "Пересекается с 12:00–13:00",
    );
  });

  test("reports break, outside hours and travel buffer", () => {
    const band = {
      startMin: 9 * 60,
      endMin: 18 * 60,
      breaks: [{ startMin: 13 * 60, endMin: 14 * 60 }],
    };
    assert.equal(
      rescheduleWarning(
        target,
        { date: neighbor.date, timeStart: "13:15", timeEnd: "13:45" },
        [target],
        band,
        30,
      ),
      "Попадает на перерыв бригады",
    );
    assert.equal(
      rescheduleWarning(
        target,
        { date: neighbor.date, timeStart: "08:00", timeEnd: "09:00" },
        [target],
        band,
        30,
      ),
      "Вне рабочих часов бригады",
    );
    assert.equal(
      rescheduleWarning(
        target,
        { date: neighbor.date, timeStart: "11:40", timeEnd: "12:00" },
        [target, neighbor],
        band,
        30,
      ),
      "Меньше 30 мин до 12:00–13:00",
    );
  });

  test("events do not inherit work-schedule warnings", () => {
    assert.equal(
      rescheduleWarning(
        { ...target, kind: "event" },
        { date: neighbor.date, timeStart: "12:30", timeEnd: "13:30" },
        [neighbor],
        null,
        30,
      ),
      null,
    );
  });
});
