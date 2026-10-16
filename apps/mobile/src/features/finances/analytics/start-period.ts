import { makePeriod, type Period, type PeriodKind } from "@/lib/period";

// ПЕРИОД, С КОТОРЫМ ОТКРЫВАЕТСЯ «АНАЛИТИКА» ИЗ «ФИНАНСОВ».
//
// «Финансы» передают пресет словом (`?period=month`), а не датами, — значит,
// даты строятся здесь заново, и строятся ПО ЧАСАМ КОМПАНИИ, как у «Финансов».
// По часам телефона в 00:30 первого числа у кипрской компании телефон в
// Лондоне открыл бы прошлый месяц, а «Финансы» показывали текущий.

const KINDS: readonly PeriodKind[] = [
  "today", "yesterday", "week", "lastweek", "month", "lastmonth",
  "quarter", "lastquarter", "year", "lastyear",
];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Период из адреса; `null` — адрес периода не задаёт (или задаёт битый).
 *  `now` — «сейчас» в поясе компании. */
export function analyticsStartPeriod(
  params: { period?: string; from?: string; to?: string },
  now: Date,
): Period | null {
  const { period, from, to } = params;
  if (period === "custom") {
    return from && to && YMD.test(from) && YMD.test(to) && from <= to
      ? { preset: "custom", from, to }
      : null;
  }
  return KINDS.includes(period as PeriodKind) ? makePeriod(period as PeriodKind, now) : null;
}
