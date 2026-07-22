import type { Appointment } from "@babun/shared/local/appointments";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";

export interface RescheduleWorkBand {
  startMin: number;
  endMin: number;
  breaks?: { startMin: number; endMin: number }[];
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return (hours || 0) * 60 + (mins || 0);
}

/** One prioritized warning for a proposed move. Warnings never block the
 * dispatcher: overlap > non-working/break/hours > travel buffer. */
export function rescheduleWarning(
  appointment: Appointment,
  next: { date: string; timeStart: string; timeEnd: string },
  appointments: Appointment[],
  workBand: RescheduleWorkBand | null | undefined,
  bufferMinutes: number,
): string | null {
  if (appointment.kind !== "work") return null;
  const others = appointments.filter(
    (candidate) =>
      (candidate as { virtualParentId?: string }).virtualParentId !==
      appointment.id,
  );
  const candidate = {
    ...appointment,
    date: next.date,
    time_start: next.timeStart,
    time_end: next.timeEnd,
  };
  const overlap = findOverlap(candidate, others);
  if (overlap) return `Пересекается с ${overlap.time_start}–${overlap.time_end}`;

  const startMin = minutes(next.timeStart);
  const endMin = minutes(next.timeEnd);
  if (workBand === null) return "Нерабочий день бригады";
  if (
    workBand?.breaks?.some(
      (pause) => startMin < pause.endMin && endMin > pause.startMin,
    )
  ) {
    return "Попадает на перерыв бригады";
  }
  if (
    workBand &&
    (startMin < workBand.startMin || endMin > workBand.endMin)
  ) {
    return "Вне рабочих часов бригады";
  }

  const tight = findBufferClash(candidate, others, bufferMinutes);
  return tight
    ? `Меньше ${bufferMinutes} мин до ${tight.time_start}–${tight.time_end}`
    : null;
}
