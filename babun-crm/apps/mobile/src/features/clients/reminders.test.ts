import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clientReminderFireDate,
  parseClientNotificationTarget,
} from "./reminders";

describe("client reminders", () => {
  test("turns a date-only value into local 09:00 without UTC day drift", () => {
    const result = clientReminderFireDate(
      "2026-07-21",
      new Date(2026, 6, 20, 23, 59),
    );
    assert.ok(result);
    assert.equal(result.getFullYear(), 2026);
    assert.equal(result.getMonth(), 6);
    assert.equal(result.getDate(), 21);
    assert.equal(result.getHours(), 9);
    assert.equal(result.getMinutes(), 0);
  });

  test("rejects invalid and already elapsed dates", () => {
    assert.equal(
      clientReminderFireDate("2026-02-30", new Date(2026, 0, 1)),
      null,
    );
    assert.equal(
      clientReminderFireDate("2026-07-20", new Date(2026, 6, 20, 9, 1)),
      null,
    );
  });

  test("accepts only a bounded client reminder target", () => {
    assert.deepEqual(
      parseClientNotificationTarget({
        type: "client-reminder",
        clientId: "client-1",
      }),
      { clientId: "client-1" },
    );
    assert.equal(
      parseClientNotificationTarget({ type: "calendar-appointment", clientId: "client-1" }),
      null,
    );
    assert.equal(
      parseClientNotificationTarget({
        type: "client-reminder",
        clientId: "x".repeat(129),
      }),
      null,
    );
  });
});
