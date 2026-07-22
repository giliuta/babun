// Per-day financial summary — the numbers shown in the calendar's
// pinned day footer, the month-view day cells, and the day-finance
// detail popup. One source of truth so all three consumers always
// agree (the footer total can never drift from the popup breakdown).
//
// The income/expense/profit math intentionally mirrors the legacy
// DayFinanceModal so existing days keep the same totals.

import type { Appointment } from "../appointments";
import { getPaidAmount } from "../appointments";
import type { Service } from "../services";
import type { DayExtra } from "../day-extras";
import { sumExtras } from "../day-extras";
import { appointmentMaterialCost } from "./appointment-calc";

// ─── Payment-method breakdown (for the detail popup) ────────────────
export interface DayPaymentBreakdown {
  cash: number;
  card: number;
  transfer: number;
  /** Перевод/инвойс/аванс без явного метода и пр. */
  other: number;
}

export interface DayFinanceTotals {
  /** Сколько можно заработать — сумма по не-отменённым записям. */
  planned: number;
  /** Фактически заработано (оплачено) + ручной доход. */
  earned: number;
  /** Потрачено за день. */
  spent: number;
  /** Прибыль = earned − spent. */
  profit: number;
  /** Разбивка фактических платежей по способу оплаты. */
  byMethod: DayPaymentBreakdown;
  /** true если есть хоть какая-то ненулевая цифра — чтобы решить,
   *  рисовать ли строку вообще (пустые дни остаются чистыми). */
  hasAny: boolean;
}

const isClosable = (a: Appointment) =>
  a.status === "completed" || a.status === "in_progress";

/**
 * Compute the day's finance totals.
 *
 * @param appointments  ВСЕ записи дня (фильтрация по дате/команде —
 *                       на стороне вызывающего).
 * @param services      справочник услуг (для материалов).
 * @param extras        ручные доход/расход за этот день.
 */
export function computeDayFinance(
  appointments: Appointment[],
  services: Service[],
  extras: DayExtra[],
): DayFinanceTotals {
  const earnedFromAppts = appointments
    .filter(isClosable)
    .reduce((sum, a) => sum + getPaidAmount(a), 0);

  const materialCost = appointments
    .filter(isClosable)
    .reduce((sum, appointment) => {
      return sum + appointmentMaterialCost(appointment, services);
    }, 0);

  // Mirror DayFinanceModal: manual expenses summed across ALL records.
  const manualExpenses = appointments.reduce(
    (sum, a) => sum + a.expenses.reduce((s, e) => s + e.amount, 0),
    0,
  );

  const planned = appointments
    .filter(
      (a) =>
        a.status !== "cancelled" && a.payment_status !== "refunded",
    )
    .reduce((sum, a) => sum + a.total_amount, 0);

  const extrasSum = sumExtras(extras);

  const earned = earnedFromAppts + extrasSum.income;
  const spent = materialCost + manualExpenses + extrasSum.expense;
  const profit = earned - spent;

  const byMethod: DayPaymentBreakdown = {
    cash: 0,
    card: 0,
    transfer: 0,
    other: 0,
  };
  for (const a of appointments) {
    if (!isClosable(a)) continue;
    // Keep the original receipts on the appointment for history, but a fully
    // refunded visit contributes no current tender to the day's breakdown.
    if (a.payment_status === "refunded") continue;
    for (const p of a.payments) {
      if (p.method === "cash") byMethod.cash += p.amount;
      else if (p.method === "card") byMethod.card += p.amount;
      else if (p.method === "transfer") byMethod.transfer += p.amount;
      else byMethod.other += p.amount;
    }
    if (a.prepaid_amount > 0) {
      // Способ аванса сохраняется на самой записи. Legacy-аванс без метода
      // остаётся в «прочее»: приписывать его кассе или карте нельзя.
      if (a.payment_method === "cash") byMethod.cash += a.prepaid_amount;
      else if (a.payment_method === "card") byMethod.card += a.prepaid_amount;
      else if (a.payment_method === "transfer") {
        byMethod.transfer += a.prepaid_amount;
      } else byMethod.other += a.prepaid_amount;
    }
  }

  return {
    planned,
    earned,
    spent,
    profit,
    byMethod,
    hasAny: planned !== 0 || earned !== 0 || spent !== 0,
  };
}

// ─── Day mode (drives the finance modal layout) ─────────────────────
// By date, not by data: past day shows the closed-day P&L, today shows
// progress, future shows the plan. Both keys must be YYYY-MM-DD so the
// lexicographic compare matches chronological order.
export type DayMode = "future" | "today" | "past";

export function getDayMode(dateKey: string, todayKey: string): DayMode {
  if (dateKey > todayKey) return "future";
  if (dateKey < todayKey) return "past";
  return "today";
}
