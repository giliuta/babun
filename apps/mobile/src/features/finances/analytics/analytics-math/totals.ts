// Money and work totals of a slice, and the per-service breakdown.

import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount, getPaidAmount } from "@babun/shared/local/appointments";
import {
  appointmentMaterialCost,
  lineTotal,
} from "@babun/shared/local/finance/appointment-calc";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Service } from "@babun/shared/local/services";
import { cents, euros, inScope, ledgerInScope, recordMinutes, type Scope } from "./scope";

export interface ServiceRow {
  id: string;
  name: string;
  /** Штук: сумма количеств по всем записям («×3 A/C Чистка» — три штуки). */
  quantity: number;
  /** В скольких записях встречалась. */
  records: number;
  amount: number;
}

/**
 * «ГРАДАЦИЯ ПО УСЛУГАМ»: что сделали, сколько штук и на какую сумму. Сумма —
 * строки записи (`lineTotal`: цена × шт − скидка строки), имя — со снимка
 * записи, а если его нет — из справочника: удалённая услуга остаётся в
 * истории под своим именем. Крупные сверху.
 */
export function serviceBreakdown(
  records: readonly Appointment[],
  catalog: ReadonlyMap<string, string>,
): ServiceRow[] {
  const by = new Map<string, { name: string; qty: number; recs: Set<string>; c: number }>();
  for (const a of records) {
    for (const line of a.services ?? []) {
      const id = line.serviceId;
      const name = line.serviceName?.trim() || catalog.get(id) || "Услуга удалена";
      const row = by.get(id) ?? { name, qty: 0, recs: new Set<string>(), c: 0 };
      row.qty += line.quantity ?? 1;
      row.recs.add(a.id);
      row.c += cents(lineTotal(line));
      by.set(id, row);
    }
  }
  return [...by.entries()]
    .map(([id, r]) => ({
      id,
      name: r.name,
      quantity: r.qty,
      records: r.recs.size,
      amount: euros(r.c),
    }))
    .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);
}

export interface MoneyTotals {
  income: number;
  expense: number;
  profit: number;
}

/** Деньги среза — правилом плиток «Финансов». */
export function moneyTotals(
  transactions: readonly FinanceTransaction[],
  appointments: readonly Appointment[],
  services: readonly Service[],
  s: Scope,
): MoneyTotals {
  let inc = 0;
  let exp = 0;
  for (const tx of ledgerInScope(transactions, s)) {
    if (tx.type === "income" || tx.type === "refund") inc += cents(signedAmount(tx));
    else if (tx.type === "expense") exp += cents(tx.amount);
  }
  exp += cents(materialTotals(appointments, services, s).amount);
  return { income: euros(inc), expense: euros(exp), profit: euros(inc - exp) };
}

export interface WorkTotals {
  records: number;
  /** Сумма работ по записям («работ на»). */
  worked: number;
  /** Сколько по этим записям пришло денег (включая предоплату). */
  paid: number;
  /** Сколько по ним ещё не пришло — долг записи (`getDebtAmount`), как у
   *  плитки «Долги»: переплата одной записи не гасит долг другой. */
  owed: number;
  /** Средний чек — работ на одну запись. */
  averageCheck: number;
  minutes: number;
  /** Работ на час; `null` — часов нет. */
  perHour: number | null;
}

// «РАБОТ НА» — СУММА ЗАПИСИ К ОПЛАТЕ (`total_amount`), а не сумма строк
// услуг. Строки не знают ни общей скидки записи, ни ручного «Итого», ни VAT,
// а оплаты и долг считаются от `total_amount`: полностью оплаченный визит со
// скидкой 10% показывал «Не оплачено €10», хотя плитка «Долги» давала ноль.
// Полный возврат работу не оплачивает и долга не
// открывает — у такой записи ноль, как в `getRecognizedRevenue`.
export function workTotals(records: readonly Appointment[]): WorkTotals {
  let worked = 0;
  let paid = 0;
  let owed = 0;
  let minutes = 0;
  for (const a of records) {
    if (a.payment_status !== "refunded") worked += cents(a.total_amount ?? 0);
    paid += cents(getPaidAmount(a));
    owed += cents(getDebtAmount(a));
    minutes += recordMinutes(a);
  }
  const n = records.length;
  return {
    records: n,
    worked: euros(worked),
    paid: euros(paid),
    owed: euros(owed),
    averageCheck: n > 0 ? Math.round(worked / n) / 100 : 0,
    minutes,
    perHour: minutes > 0 ? Math.round((worked / (minutes / 60))) / 100 : null,
  };
}

/** Материалы выполненных записей среза — строка «Материалы» в расходе. */
export function materialTotals(
  appointments: readonly Appointment[],
  services: readonly Service[],
  s: Scope,
): { amount: number; count: number } {
  let c = 0;
  let count = 0;
  for (const a of appointments) {
    if (a.status !== "completed" && a.status !== "in_progress") continue;
    if (!inScope(a, s)) continue;
    const cost = cents(appointmentMaterialCost(a, services as Service[]));
    if (cost <= 0) continue;
    c += cost;
    count += 1;
  }
  return { amount: euros(c), count };
}
