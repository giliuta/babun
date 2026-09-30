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

// ── НАПОМИНАНИЕ СЕБЕ ──
// Колокольчик в шапке записи и события (владелец 24.09: «напомнить за какое-то
// время — за 24 часа, или свой диапазон: дни и время; вылазит пуш»). Правило
// хранит СМЕЩЕНИЕ, а не момент: запись переносят — пуш едет следом.

export type SelfReminder =
  /** За N минут до начала. */
  | { kind: "before"; minutes: number }
  /** За N дней до даты записи, в заданное время суток. */
  | { kind: "dayAt"; daysBefore: number; time: string };

/** Готовые варианты режима «Заранее» — за сколько до начала. */
export const SELF_REMINDER_BEFORE_PRESETS: readonly SelfReminder[] = [
  { kind: "before", minutes: 15 },
  { kind: "before", minutes: 60 },
  { kind: "before", minutes: 24 * 60 },
];

/** Готовые варианты режима «Ко времени» — в какой день и во сколько. */
export const SELF_REMINDER_AT_PRESETS: readonly SelfReminder[] = [
  { kind: "dayAt", daysBefore: 0, time: "08:00" },
  { kind: "dayAt", daysBefore: 1, time: "20:00" },
];

/** Все готовые варианты (для узнавания «стоит готовый или свой»). */
export const SELF_REMINDER_PRESETS: readonly SelfReminder[] = [
  ...SELF_REMINDER_BEFORE_PRESETS,
  ...SELF_REMINDER_AT_PRESETS,
];

export function sameSelfReminder(a: SelfReminder | null, b: SelfReminder | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "before" && b.kind === "before") return a.minutes === b.minutes;
  if (a.kind === "dayAt" && b.kind === "dayAt") {
    return a.daysBefore === b.daysBefore && a.time === b.time;
  }
  return false;
}

const dayWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
};

/** День напоминания словами: «В день записи», «Накануне», «За 3 дня». */
export function reminderDayLabel(daysBefore: number): string {
  if (daysBefore === 0) return "В день записи";
  if (daysBefore === 1) return "Накануне";
  return `За ${daysBefore} ${dayWord(daysBefore)}`;
}

/** Правило словами: «За 15 минут», «За 24 часа», «За 1 день 2 ч 30 мин»,
 *  «Накануне в 20:00», «В день записи в 10:00», «За 3 дня в 09:00». */
export function selfReminderLabel(rule: SelfReminder): string {
  if (rule.kind === "dayAt") {
    return `${reminderDayLabel(rule.daysBefore)} в ${rule.time}`;
  }
  const total = rule.minutes;
  if (total === 24 * 60) return "За 24 часа";
  if (total === 60) return "За 1 час";
  if (total < 60) return `За ${total} минут`;
  const d = Math.floor(total / (24 * 60));
  const h = Math.floor((total % (24 * 60)) / 60);
  const m = total % 60;
  const parts = [
    d > 0 ? `${d} ${dayWord(d)}` : null,
    h > 0 ? `${h} ч` : null,
    m > 0 ? `${m} мин` : null,
  ].filter(Boolean);
  return `За ${parts.join(" ")}`;
}

/** Момент пуша в часовом поясе команды записи. */
export function selfReminderInstant(
  appointment: AppointmentWallTime,
  rule: SelfReminder,
  timeZone: string,
): Date {
  if (rule.kind === "before") {
    const start = zonedWallTimeToInstant(
      appointment.date,
      appointment.time_start,
      timeZone,
    );
    return new Date(start.getTime() - rule.minutes * 60 * 1000);
  }
  return zonedWallTimeToInstant(
    shiftDateKey(appointment.date, -rule.daysBefore),
    rule.time,
    timeZone,
  );
}
