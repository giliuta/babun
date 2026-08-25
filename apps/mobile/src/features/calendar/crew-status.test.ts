import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nextCrewAppointmentStatus } from "./crew-status";

describe("crew calendar status policy", () => {
  test("offers only the next server-authorized transition", () => {
    assert.equal(nextCrewAppointmentStatus("scheduled"), "in_progress");
    assert.equal(nextCrewAppointmentStatus("in_progress"), "completed");
  });

  test("does not reopen terminal appointments", () => {
    assert.equal(nextCrewAppointmentStatus("completed"), null);
    assert.equal(nextCrewAppointmentStatus("cancelled"), null);
  });
});
