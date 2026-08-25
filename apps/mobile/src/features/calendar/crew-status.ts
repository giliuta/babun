import type { AppointmentStatus } from "@babun/shared/local/appointments";

/** The only status transition a master may perform from the calendar.
 * Mirrors the server's scheduled → in_progress → completed policy. */
export function nextCrewAppointmentStatus(
  current: AppointmentStatus,
): AppointmentStatus | null {
  if (current === "scheduled") return "in_progress";
  if (current === "in_progress") return "completed";
  return null;
}
