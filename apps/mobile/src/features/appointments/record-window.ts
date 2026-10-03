// «ОГРАНИЧЕНИЯ» ЗАПИСЕЙ КАЛЕНДАРЯ (владелец 03.10: «как в клиентах… чтобы
// записи после какого-то времени у мастера он больше не мог их видеть»).
//
// Копия окна сервера (`member_record_window_start`, миграция
// 20261004003717): прошедшая РАБОТА старше окна партнёру не видна, будущие
// записи и события — всегда. Ступени и длины — те же, что у «Ограничений»
// клиентов. Здесь она нужна режиму «его глазами»: записи там читаются
// токеном владельца, то есть все, и режутся на телефоне тем же правилом.

import { formatYMD, parseYMD } from "./helpers";

export type RecordWindow = "week" | "near" | "month" | "quarter" | "half" | "own";

const WINDOWS: ReadonlySet<string> = new Set(["week", "near", "month", "quarter", "half", "own"]);

/** Ступень из карты прав; неизвестное — самое узкое, «Неделя» (как сервер). */
export function asRecordWindow(level: string | null | undefined): RecordWindow {
  if (level === "all") return "own";
  return level && WINDOWS.has(level) ? (level as RecordWindow) : "week";
}

/** С какого дня видна прошедшая работа; `null` — без ограничения. */
export function recordWindowStart(window: RecordWindow, today: string): string | null {
  if (window === "own") return null;
  const day = parseYMD(today);
  if (window === "week") day.setDate(day.getDate() - 7);
  else if (window === "near") day.setDate(day.getDate() - 14);
  else {
    // Как `date - interval 'N months'` в Postgres: 31 марта минус месяц —
    // 28 февраля, а не «3 марта», как дал бы голый `setMonth`.
    const months = window === "month" ? 1 : window === "quarter" ? 3 : 6;
    const wanted = day.getDate();
    day.setDate(1);
    day.setMonth(day.getMonth() - months);
    const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    day.setDate(Math.min(wanted, last));
  }
  return formatYMD(day);
}

/** Запись спрятана окном: только работа, только старше начала окна. */
export function hiddenByWindow(
  record: { kind: string; date: string },
  window: RecordWindow,
  today: string,
): boolean {
  if (record.kind !== "work") return false;
  const start = recordWindowStart(window, today);
  return start !== null && record.date < start;
}
