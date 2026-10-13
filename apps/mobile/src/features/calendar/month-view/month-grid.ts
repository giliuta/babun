// Pure grid of the month view: 6×7 cells, local date keys, records by day.

import type { Appointment } from "@babun/shared/local/appointments";
import { weekdayIndex } from "../week";

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

export function groupByDate(appointments: Appointment[]) {
  const map = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const arr = map.get(a.date) ?? [];
    arr.push(a);
    map.set(a.date, arr);
  }
  return map;
}

/** 42 days from the week start that holds the 1st of `month`. */
export function monthCells(month: Date): Date[] {
  const y = month.getFullYear();
  const m = month.getMonth();
  const startDow = weekdayIndex(new Date(y, m, 1).getDay());
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) out.push(new Date(y, m, 1 - startDow + i));
  return out;
}
