import {
  zonedWallTimeToInstant,
} from "@babun/shared/common/utils/date-utils";
import { expandRepeat } from "@babun/shared/common/utils/expand-repeat";
import type { Appointment } from "@babun/shared/local/appointments";

export type AppointmentReminderTiming =
  | "before-30"
  | "before-60"
  | "previous-day-20"
  | "same-day-08";

type AppointmentWallTime = {
  date: string;
  time_start: string;
};

function shiftDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`Некорректная дата записи: ${dateKey}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const proof = new Date(Date.UTC(year, month - 1, day));
  if (
    proof.getUTCFullYear() !== year ||
    proof.getUTCMonth() + 1 !== month ||
    proof.getUTCDate() !== day
  ) {
    throw new RangeError(`Некорректная дата записи: ${dateKey}`);
  }
  proof.setUTCDate(proof.getUTCDate() + days);
  return proof.toISOString().slice(0, 10);
}

/** Resolve a reminder against the appointment's brigade/business timezone. */
export function appointmentReminderInstant(
  appointment: AppointmentWallTime,
  timing: AppointmentReminderTiming,
  timeZone: string,
): Date {
  if (timing === "before-30" || timing === "before-60") {
    const start = zonedWallTimeToInstant(
      appointment.date,
      appointment.time_start,
      timeZone,
    );
    const offsetMinutes = timing === "before-30" ? 30 : 60;
    return new Date(start.getTime() - offsetMinutes * 60 * 1000);
  }
  if (timing === "previous-day-20") {
    return zonedWallTimeToInstant(
      shiftDateKey(appointment.date, -1),
      "20:00",
      timeZone,
    );
  }
  return zonedWallTimeToInstant(appointment.date, "08:00", timeZone);
}

export interface EventReminderOccurrence {
  when: Date;
  label: string;
  date: string;
}

function dateKeyInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function shiftDateKeyUtc(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function offsetLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "За день" : `За ${days} дн.`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "За час" : `За ${hours} ч.`;
  }
  return `За ${minutes} мин.`;
}

/** Resolve persisted event push metadata into concrete native notification
 * instants. Recurring events are expanded for a bounded horizon and capped so
 * one infinite series cannot exhaust iOS' scheduled-notification budget. */
export function eventReminderOccurrences(
  appointment: Appointment,
  timeZone: string,
  now = new Date(),
  options: { horizonDays?: number; maxCount?: number } = {},
): EventReminderOccurrence[] {
  if (
    (appointment.kind !== "event" && appointment.kind !== "personal") ||
    !appointment.event_push_enabled
  ) {
    return [];
  }
  const exact = appointment.event_push_at
    ? new Date(appointment.event_push_at)
    : null;
  if (exact && Number.isFinite(exact.getTime())) {
    return exact.getTime() > now.getTime()
      ? [
          {
            when: exact,
            label: "В выбранное время",
            date: appointment.date,
          },
        ]
      : [];
  }

  const offsets = Array.from(
    new Set(
      (appointment.event_push_offsets ?? []).filter(
        (value) => Number.isFinite(value) && value >= 0,
      ),
    ),
  );
  if (offsets.length === 0) return [];

  const from = dateKeyInZone(now, timeZone);
  const to = shiftDateKeyUtc(from, options.horizonDays ?? 180);
  const occurrences = expandRepeat(appointment, from, to);
  const result: EventReminderOccurrence[] = [];
  for (const occurrence of occurrences) {
    const start = zonedWallTimeToInstant(
      occurrence.date,
      occurrence.time_start,
      timeZone,
    );
    for (const offset of offsets) {
      const when = new Date(start.getTime() - offset * 60_000);
      if (when.getTime() > now.getTime()) {
        result.push({
          when,
          label: offsetLabel(offset),
          date: occurrence.date,
        });
      }
    }
  }
  return result
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .slice(0, options.maxCount ?? 32);
}
