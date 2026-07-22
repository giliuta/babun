import type { Appointment } from "@babun/shared/local/appointments";
import type { UserRole } from "@/features/settings/role-policy";

export function isCalendarEvent(
  appointment: Pick<Appointment, "kind">,
): boolean {
  return appointment.kind === "event" || appointment.kind === "personal";
}

/**
 * Mirrors the appointment UPDATE policy:
 * - owner/dispatcher may update any work appointment;
 * - an event may be updated only by the operator who created it;
 * - masters never use the broad appointment update path.
 *
 * Missing `created_by` fails closed. This matters for an old offline cache:
 * showing a read-only event is preferable to presenting controls that RLS
 * will reject after the user has edited the form.
 */
export function canMutateCalendarAppointment(
  role: UserRole | null | undefined,
  userId: string | null | undefined,
  appointment: Pick<Appointment, "kind" | "created_by">,
): boolean {
  if (role !== "owner" && role !== "dispatcher") return false;
  if (!isCalendarEvent(appointment)) return true;
  return !!userId && appointment.created_by === userId;
}
