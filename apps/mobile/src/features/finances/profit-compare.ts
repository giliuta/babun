import { signedAmount } from "@babun/shared/local/finance/transaction";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Appointment } from "@babun/shared/local/appointments";
import { appointmentMaterialCost } from "@babun/shared/local/finance/appointment-calc";
import type { Service } from "@/features/services/queries";
import { changePct } from "./analytics/analytics-math";
import { inTeamScope } from "./team-scope";

// «ПРИБЫЛЬ» К ПРОШЛОМУ ПЕРИОДУ (владелец 2026-09-30: «делай, только всё это
// в прибыли… аналитику такую — только в прибыли»).
//
// Сравнение живёт ТОЛЬКО в панели «Прибыль»: на плитках и в других разрезах
// его нет. Прошлый период — тот же, что у «Аналитики» (`previousPeriod`):
// идущий месяц сравнивается с теми же днями прошлого, иначе в середине
// месяца любая цифра выглядела бы падением.
//
// Деньги прошлого периода считаются ТЕМИ ЖЕ правилами, что плитки сейчас:
// доход — доходы и возвраты со знаком, расход — расходы плюс материалы
// сделанных записей периода. Иначе «было» и «стало» мерились бы разными
// линейками.

export interface PeriodMaterials {
  amount: number;
  appointmentCount: number;
  /** Записи, у которых материалы есть, — для подписи услуг. */
  costly: Appointment[];
}

/** Материалы сделанных записей периода в команде чипа — строка «Материалы»
 *  расхода. Без права видеть деньги записей — нули: сотруднику записи
 *  приходят с нулями, и такая цифра была бы выдумкой. */
export function periodMaterials(
  appointments: readonly Appointment[],
  services: readonly Service[],
  range: { from: string; to: string; scope: string | null | undefined },
  recordMoney: boolean,
): PeriodMaterials {
  const out: PeriodMaterials = { amount: 0, appointmentCount: 0, costly: [] };
  if (!recordMoney) return out;
  let cents = 0;
  for (const appointment of appointments) {
    if (appointment.status !== "completed" && appointment.status !== "in_progress") continue;
    if (appointment.date < range.from || appointment.date > range.to) continue;
    if (!inTeamScope(appointment.team_id, range.scope)) continue;
    const cost = appointmentMaterialCost(appointment, services);
    if (cost <= 0) continue;
    cents += Math.round(cost * 100);
    out.appointmentCount += 1;
    out.costly.push(appointment);
  }
  out.amount = cents / 100;
  return out;
}

export interface PeriodMoney {
  income: number;
  expense: number;
  profit: number;
}

/** Доход, расход (с материалами) и прибыль периода — правилом плиток. */
export function periodMoney(
  transactions: readonly FinanceTransaction[],
  materials: number,
): PeriodMoney {
  let income = 0;
  let expense = Math.round(materials * 100);
  for (const tx of transactions) {
    if (tx.type === "income" || tx.type === "refund") income += Math.round(signedAmount(tx) * 100);
    else if (tx.type === "expense") expense += Math.round(tx.amount * 100);
  }
  return { income: income / 100, expense: expense / 100, profit: (income - expense) / 100 };
}

/** Изменение к прошлому: стрелка, процент и смысл. Рост расхода — плохо,
 *  поэтому смысл задаёт `goodUp`, а не знак. `null` — сравнивать не с чем
 *  (прошлое ноль) или не изменилось. */
export function changeOf(
  now: number,
  before: number,
  goodUp: boolean,
): { text: string; good: boolean } | null {
  const pct = changePct(now, before);
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  return { text: `${up ? "↑" : "↓"} ${Math.abs(pct)}%`, good: up === goodUp };
}
