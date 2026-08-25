import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import {
  appointmentReminderInstant,
  eventReminderOccurrences,
} from "./reminder-time";

const appointment = { date: "2026-07-20", time_start: "10:00" };

describe("appointmentReminderInstant", () => {
  test("keeps the brigade timezone when the device timezone differs", () => {
    assert.equal(
      appointmentReminderInstant(
        appointment,
        "before-60",
        "America/New_York",
      ).toISOString(),
      "2026-07-20T13:00:00.000Z",
    );
    assert.equal(
      appointmentReminderInstant(
        appointment,
        "before-60",
        "Europe/Nicosia",
      ).toISOString(),
      "2026-07-20T06:00:00.000Z",
    );
  });

  test("subtracts elapsed time across a spring-DST jump", () => {
    assert.equal(
      appointmentReminderInstant(
        { date: "2026-03-08", time_start: "03:30" },
        "before-60",
        "America/New_York",
      ).toISOString(),
      "2026-03-08T06:30:00.000Z",
    );
  });

  test("builds previous-day and same-day wall-clock presets in the zone", () => {
    assert.equal(
      appointmentReminderInstant(
        { date: "2026-03-08", time_start: "10:00" },
        "previous-day-20",
        "America/New_York",
      ).toISOString(),
      "2026-03-08T01:00:00.000Z",
    );
    assert.equal(
      appointmentReminderInstant(
        { date: "2026-03-08", time_start: "10:00" },
        "same-day-08",
        "America/New_York",
      ).toISOString(),
      "2026-03-08T12:00:00.000Z",
    );
  });
});

describe("eventReminderOccurrences", () => {
  test("expands recurring event offsets in the business timezone", () => {
    const event = createBlankAppointment({
      kind: "event",
      date: "2026-07-20",
      time_start: "10:00",
      time_end: "11:00",
      event_push_enabled: true,
      event_push_offsets: [60],
      event_repeat: { kind: "daily", until: "2026-07-22" },
    });
    const reminders = eventReminderOccurrences(
      event,
      "Europe/Nicosia",
      new Date("2026-07-20T00:00:00.000Z"),
    );
    assert.deepEqual(
      reminders.map((item) => item.when.toISOString()),
      [
        "2026-07-20T06:00:00.000Z",
        "2026-07-21T06:00:00.000Z",
        "2026-07-22T06:00:00.000Z",
      ],
    );
  });

  test("exact reminder wins over offsets and past reminders are dropped", () => {
    const event = createBlankAppointment({
      kind: "event",
      date: "2026-07-20",
      time_start: "10:00",
      time_end: "11:00",
      event_push_enabled: true,
      event_push_offsets: [60],
      event_push_at: "2026-07-19T20:00:00.000Z",
    });
    assert.deepEqual(
      eventReminderOccurrences(
        event,
        "Europe/Nicosia",
        new Date("2026-07-20T00:00:00.000Z"),
      ),
      [],
    );
  });
});
