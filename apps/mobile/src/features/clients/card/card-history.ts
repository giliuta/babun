// Appointment lists of the read-only client views (deleted client, master).

import type { Appointment } from "@babun/shared/local/appointments";

/** Newest first by date and start time; the input is not touched. */
export function newestFirst(appointments: readonly Appointment[]): Appointment[] {
  return [...appointments].sort((a, b) =>
    `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`),
  );
}

/** Names of the appointment's services that the catalog still knows. */
export function serviceNamesOf(
  appointment: Pick<Appointment, "service_ids">,
  serviceById: ReadonlyMap<string, string>,
): string[] {
  return appointment.service_ids
    .map((serviceId) => serviceById.get(serviceId))
    .filter((name): name is string => !!name);
}
