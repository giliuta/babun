// Beta #49 (CRM Core brief) — equipment service schedule helper.
//
// Pure compute on top of the optional `installed_at` /
// `last_service_at` / `service_interval_months` fields on `ACUnit`.
// The UI calls `serviceDueState(unit)` and renders «нужно
// обслуживание» / «через N дн.» / no badge accordingly.
//
// Day arithmetic is calendar-day (local timezone), matching the
// `formatDateLongRu` family. Edge cases:
//   • interval missing → return null (no schedule, no badge).
//   • neither installed_at nor last_service_at → use today as base
//     so the first cycle fires `interval` months from now, not
//     immediately. Operator can fill the install date later.

import { addMonthsYYYYMMDD } from "./recurring";

export interface ServiceDueState {
  /** YYYY-MM-DD of the next scheduled service. */
  nextDate: string;
  /** Days until next service. Negative = overdue. */
  daysUntil: number;
  /** Convenience flags the badge consumer toggles on. */
  overdue: boolean;
  soon: boolean; // 0 ≤ daysUntil ≤ 14
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): Date | null {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function daysBetween(a: Date, b: Date): number {
  const oneDay = 86400000;
  return Math.round((b.getTime() - a.getTime()) / oneDay);
}

interface UnitSchedule {
  installed_at?: string;
  last_service_at?: string;
  service_interval_months?: number;
}

/** Валидная дата YYYY-MM-DD или null: свободный ввод и легаси приносили
 *  сюда мусор, от которого график считался наугад. */
function validYmd(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function serviceDueState(unit: UnitSchedule): ServiceDueState | null {
  const interval = unit.service_interval_months;
  if (!interval || interval <= 0) return null;
  // База = САМАЯ ПОЗДНЯЯ из известных дат. Фолбэка «сегодня» больше нет: он
  // означал «обслужили сегодня», поэтому у техники без дат график НИКОГДА не
  // срабатывал — план просто уезжал вперёд вместе с сегодняшним днём. Нет
  // базы — нет и графика, и это честно: сначала надо указать дату.
  const dates = [
    validYmd(unit.last_service_at),
    validYmd(unit.installed_at),
  ].filter((d): d is string => d !== null);
  if (dates.length === 0) return null;
  const base = dates.sort()[dates.length - 1];
  const nextDate = addMonthsYYYYMMDD(base, interval);
  const today = parseKey(todayKey());
  const next = parseKey(nextDate);
  if (!today || !next) return null;
  const daysUntil = daysBetween(today, next);
  return {
    nextDate,
    daysUntil,
    overdue: daysUntil < 0,
    soon: daysUntil >= 0 && daysUntil <= 14,
  };
}
