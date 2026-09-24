import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import {
  appointmentReminderInstant,
  eventReminderOccurrences,
  sameSelfReminder,
  selfReminderInstant,
  selfReminderLabel,
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

describe("напоминание себе", () => {
  test("«за 24 часа» — ровно сутки до начала в поясе команды", () => {
    assert.equal(
      selfReminderInstant(
        { date: "2026-09-26", time_start: "10:00" },
        { kind: "before", minutes: 24 * 60 },
        "Europe/Nicosia",
      ).toISOString(),
      "2026-09-25T07:00:00.000Z",
    );
  });
  test("«за 3 дня в 09:00» — дата сдвигается, время суток своё", () => {
    assert.equal(
      selfReminderInstant(
        { date: "2026-09-26", time_start: "15:30" },
        { kind: "dayAt", daysBefore: 3, time: "09:00" },
        "Europe/Nicosia",
      ).toISOString(),
      "2026-09-23T06:00:00.000Z",
    );
  });
  test("подписи правил", () => {
    assert.equal(selfReminderLabel({ kind: "before", minutes: 15 }), "За 15 минут");
    assert.equal(selfReminderLabel({ kind: "before", minutes: 1440 }), "За 24 часа");
    assert.equal(selfReminderLabel({ kind: "dayAt", daysBefore: 1, time: "20:00" }), "Накануне в 20:00");
    assert.equal(selfReminderLabel({ kind: "dayAt", daysBefore: 2, time: "09:00" }), "За 2 дня в 09:00");
    assert.equal(selfReminderLabel({ kind: "dayAt", daysBefore: 5, time: "09:00" }), "За 5 дней в 09:00");
    assert.equal(selfReminderLabel({ kind: "dayAt", daysBefore: 0, time: "10:00" }), "В день записи в 10:00");
    assert.equal(selfReminderLabel({ kind: "before", minutes: 2 * 1440 }), "За 2 дня");
    assert.equal(selfReminderLabel({ kind: "before", minutes: 1440 + 150 }), "За 1 день 2 ч 30 мин");
    assert.equal(selfReminderLabel({ kind: "before", minutes: 180 }), "За 3 ч");
  });
  test("сравнение правил", () => {
    assert.equal(sameSelfReminder({ kind: "before", minutes: 60 }, { kind: "before", minutes: 60 }), true);
    assert.equal(sameSelfReminder({ kind: "before", minutes: 60 }, { kind: "dayAt", daysBefore: 0, time: "08:00" }), false);
    assert.equal(sameSelfReminder(null, null), true);
  });
});
