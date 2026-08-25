import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseAppointmentNotificationTarget } from "./reminders";

describe("parseAppointmentNotificationTarget", () => {
  test("accepts the calendar payload and keeps team context", () => {
    assert.deepEqual(
      parseAppointmentNotificationTarget({
        type: "calendar-appointment",
        appointmentId: "appointment-1",
        date: "2026-07-20",
        teamId: "team-1",
      }),
      {
        appointmentId: "appointment-1",
        date: "2026-07-20",
        teamId: "team-1",
      },
    );
  });

  test("rejects unrelated and malformed notification data", () => {
    assert.equal(
      parseAppointmentNotificationTarget({
        type: "chat",
        appointmentId: "appointment-1",
        date: "2026-07-20",
      }),
      null,
    );
    assert.equal(
      parseAppointmentNotificationTarget({
        type: "calendar-appointment",
        appointmentId: "appointment-1",
        date: "20.07.2026",
      }),
      null,
    );
  });
});
