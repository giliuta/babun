import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";

// ДОЛГ ДНЯ — когда время прошло, а «оплачено» ещё не нажали. Будущая запись
// без оплаты — не долг, а план; запись сегодня до
// её конца — тоже ещё не долг. Отменённые не считаются.
export function isPastRecord(
  a: Pick<Appointment, "date" | "time_end" | "status">,
  businessToday: string,
  nowHm: string,
): boolean {
  if (a.status === "completed") return true;
  if (a.date < businessToday) return true;
  return a.date === businessToday && (a.time_end || "23:59") <= nowHm;
}

export function dayDebtRecords(
  appointments: readonly Appointment[],
  businessToday: string,
  nowHm: string,
): Appointment[] {
  return appointments
    .filter(
      (a) =>
        a.status !== "cancelled" &&
        getDebtAmount(a) > 0 &&
        isPastRecord(a, businessToday, nowHm),
    )
    .sort((a, b) => a.time_start.localeCompare(b.time_start));
}
