// Month table of a year and the previous period to compare with.

import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Service } from "@babun/shared/local/services";
import { cents, euros, performedRecords, type Scope } from "./scope";
import { moneyTotals, workTotals, type MoneyTotals } from "./totals";

export interface MonthRow extends MoneyTotals {
  /** YYYY-MM */
  key: string;
  from: string;
  to: string;
  worked: number;
  records: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Месяцы года с января по текущий (у прошлого года — все двенадцать). */
export function yearMonths(
  year: number,
  today: string,
): { key: string; from: string; to: string }[] {
  const [ty, tm] = today.split("-").map(Number);
  const last = year < ty ? 12 : year === ty ? tm : 0;
  const out = [];
  for (let m = 1; m <= last; m += 1) {
    const end = new Date(year, m, 0).getDate();
    out.push({
      key: `${year}-${pad(m)}`,
      from: `${year}-${pad(m)}-01`,
      to: `${year}-${pad(m)}-${pad(end)}`,
    });
  }
  return out;
}

export function monthTable(
  years: { from: number; to: number } | number,
  transactions: readonly FinanceTransaction[],
  appointments: readonly Appointment[],
  services: readonly Service[],
  base: Pick<Scope, "today" | "teamId" | "accountTeam" | "nowHm">,
): { rows: MonthRow[]; total: MonthRow } {
  // ПЕРИОД ЧЕРЕЗ НОВЫЙ ГОД — ВСЕ ЕГО ГОДЫ (аудит 2026-09-24): таблица
  // строилась по году начала, и у «20.12–10.01» январь выпадал из «Итого».
  const span = typeof years === "number" ? { from: years, to: years } : years;
  const months: { key: string; from: string; to: string }[] = [];
  for (let y = span.from; y <= span.to; y += 1) months.push(...yearMonths(y, base.today));
  const rows = months.map((m) => {
    const s = { ...base, from: m.from, to: m.to };
    const money = moneyTotals(transactions, appointments, services, s);
    const work = workTotals(performedRecords(appointments, s));
    return { ...m, ...money, worked: work.worked, records: work.records };
  });
  const sum = (k: "income" | "expense" | "profit" | "worked" | "records") =>
    k === "records"
      ? rows.reduce((s, r) => s + r.records, 0)
      : euros(rows.reduce((s, r) => s + cents(r[k]), 0));
  const total: MonthRow = {
    key: span.from === span.to ? `${span.from}` : `${span.from}–${span.to}`,
    from: `${span.from}-01-01`,
    to: `${span.to}-12-31`,
    income: sum("income"),
    expense: sum("expense"),
    profit: sum("profit"),
    worked: sum("worked"),
    records: sum("records"),
  };
  return { rows, total };
}

// ─── Сравнение с прошлым периодом ─────────────────────────────────────

const ymdOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOf = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
};
const addDaysYmd = (ymd: string, n: number) => {
  const d = dateOf(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdOf(d);
};
const daysBetween = (from: string, to: string) =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * ПРОШЛЫЙ ПЕРИОД ДЛЯ СРАВНЕНИЯ — ЧЕСТНЫЙ (владелец 2026-09-24: «сравнивание
 * между месяцами — это очень хорошо»).
 *
 * Период, выровненный по календарю (месяц, квартал, год), сравнивается с
 * прошлым таким же — но ТЕМИ ЖЕ ДНЯМИ, если текущий ещё идёт: 1–24 сентября
 * против 1–24 августа, а не против всего августа. Иначе в середине месяца
 * любая цифра выглядела бы падением. Прочие периоды — отрезок той же длины
 * вплотную перед текущим.
 */
export function previousPeriod(
  from: string,
  to: string,
  today: string,
): { from: string; to: string; partial: boolean } {
  const effectiveTo = to > today && from <= today ? today : to;
  const partial = effectiveTo !== to;
  const elapsed = daysBetween(from, effectiveTo);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const monthsSpan = (ty - fy) * 12 + (tm - fm) + 1;
  const calendarAligned =
    fd === 1 && td === lastDayOfMonth(ty, tm) && [1, 3, 12].includes(monthsSpan);
  if (calendarAligned) {
    const start = new Date(Date.UTC(fy, fm - 1 - monthsSpan, 1));
    const prevFrom = ymdOf(start);
    const prevEnd = ymdOf(new Date(Date.UTC(fy, fm - 1, 0)));
    // Законченный период — весь прошлый целиком (в високосный год в нём на
    // день больше); идущий — столько же дней с начала.
    if (!partial) return { from: prevFrom, to: prevEnd, partial };
    const prevTo = addDaysYmd(prevFrom, elapsed);
    return { from: prevFrom, to: prevTo < prevEnd ? prevTo : prevEnd, partial };
  }
  // Прочий период сдвигается на ВСЮ свою длину, а сравнивается столько же
  // дней с начала. Раньше брался отрезок длины «прошедших» дней вплотную
  // перед началом: «Текущая неделя» в субботу сравнивала пн–сб с вт–вс
  // прошлой недели, в среду — пн–ср с пт–вс (аудит финансов 03.10).
  const span = daysBetween(from, to) + 1;
  const prevFrom = addDaysYmd(from, -span);
  return { from: prevFrom, to: addDaysYmd(prevFrom, elapsed), partial };
}

/** Изменение в процентах; прошлое ноль — сравнивать не с чем (`null`). */
export function changePct(current: number, previous: number): number | null {
  if (Math.round(previous * 100) === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
