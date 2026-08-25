import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { createBlankClient } from "@babun/shared/local/clients";
import { buildClientAppointmentIndex } from "./useClientFilters";

function appointment(
  id: string,
  patch: Pick<Appointment, "client_id" | "date" | "status" | "team_id">,
): Appointment {
  return {
    id,
    comment: "",
    time_start: "09:00",
    time_end: "10:00",
    ...patch,
  } as Appointment;
}

describe("buildClientAppointmentIndex", () => {
  test("does not count cancelled visits in team and period facets", () => {
    const client = createBlankClient({ id: "client-1", full_name: "Иван" });
    const index = buildClientAppointmentIndex(
      [client],
      [
        appointment("cancelled", {
          client_id: client.id,
          date: "2026-07-01",
          status: "cancelled",
          team_id: "team-cancelled",
        }),
        appointment("live", {
          client_id: client.id,
          date: "2026-07-20",
          status: "scheduled",
          team_id: "team-live",
        }),
      ],
    );

    assert.deepEqual([...index.clientTeams.get(client.id)!], ["team-live"]);
    assert.deepEqual(index.clientApptDates.get(client.id), ["2026-07-20"]);
  });
});
