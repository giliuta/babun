import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canMutateCalendarAppointment,
  isCalendarEvent,
} from "./event-access";

describe("calendar event access", () => {
  test("operators can mutate work but only their own events", () => {
    assert.equal(
      canMutateCalendarAppointment("dispatcher", "user-a", {
        kind: "work",
        created_by: null,
      }),
      true,
    );
    assert.equal(
      canMutateCalendarAppointment("dispatcher", "user-a", {
        kind: "event",
        created_by: "user-a",
      }),
      true,
    );
    assert.equal(
      canMutateCalendarAppointment("owner", "user-a", {
        kind: "event",
        created_by: "user-b",
      }),
      false,
    );
  });

  test("unknown creator and master role fail closed", () => {
    assert.equal(
      canMutateCalendarAppointment("owner", "user-a", {
        kind: "personal",
        created_by: undefined,
      }),
      false,
    );
    assert.equal(
      canMutateCalendarAppointment("master", "user-a", {
        kind: "work",
        created_by: "user-a",
      }),
      false,
    );
    assert.equal(isCalendarEvent({ kind: "personal" }), true);
    assert.equal(isCalendarEvent({ kind: "work" }), false);
  });
});
