import type { Appointment } from "@babun/shared/local/appointments";
import { appointmentDebt } from "@babun/shared/local/selectors/client-stats";

// «НЕОПЛАЧЕННЫЕ» В ИСТОРИИ ВИЗИТОВ — куда ведёт тап по «Долг €240» в сводке.
//
// Отбор — ТЕМ ЖЕ правилом, которым сводка считает долг (`appointmentDebt`
// из client-stats): выполненная с недоплатой и прошедшая, по которой бригада
// не отчиталась. Своё правило здесь (например, «только выполненные», как
// итог над историей) показало бы €150 после тапа по «Долг €240» — и
// человек перестал бы верить обоим числам.

export interface UnpaidVisits {
  /** Записи с неполученными деньгами, в порядке входа. */
  list: Appointment[];
  /** Сумма долга по ним — то же число, что «Долг» в сводке. */
  total: number;
}

export function unpaidVisits(
  appointments: readonly Appointment[],
  today: string,
): UnpaidVisits {
  const list: Appointment[] = [];
  let total = 0;
  for (const a of appointments) {
    const owed = appointmentDebt(a, today);
    if (owed <= 0) continue;
    list.push(a);
    total += owed;
  }
  return { list, total: Math.round(total) };
}
