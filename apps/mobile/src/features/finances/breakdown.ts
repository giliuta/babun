// Income/expense bucketing for the «Разбор прибыли» panel — a 1:1 mirror
// of apps/web/src/lib/finance/breakdown.ts (the web lib can't be imported
// from mobile and shared doesn't export it). Pure — no side effects.

import { signedAmount } from "@babun/shared/local/finance/transaction";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";

export interface BreakdownRow {
  /** Stable React key + accessible label (the bucket name). */
  id: string;
  name: string;
  amount: number;
  count: number;
}

/** Human label for an income tx: its category, else the linked
 *  appointment's first service, else a generic «Доход». */
export function incomeLabel(
  t: FinanceTransaction,
  categories: FinanceCategory[],
  services: Service[],
  appointments: Appointment[],
): string {
  if (t.category_id) {
    const c = categories.find((x) => x.id === t.category_id);
    if (c) return c.name;
  }
  if (t.appointment_id) {
    const a = appointments.find((x) => x.id === t.appointment_id);
    const sid = a?.service_ids?.[0];
    if (sid) {
      const s = services.find((x) => x.id === sid);
      if (s) return s.name;
    }
  }
  return "Доход";
}

/** Human label for an expense tx: its category, else its note, else
 *  «Прочее». */
export function expenseLabel(
  t: FinanceTransaction,
  categories: FinanceCategory[],
): string {
  return (
    (t.category_id && categories.find((c) => c.id === t.category_id)?.name) ||
    t.notes ||
    "Прочее"
  );
}

/** Income grouped by service/category, sorted by amount desc. Refunds
 *  are netted back into the service they reverse so the section total
 *  equals net Доход and income − expense reconciles to «Прибыль». A
 *  refund is a reversal, not a sale, so it never adds to the count; an
 *  orphan refund (its income is outside the period/scope) falls into a
 *  «Возвраты» bucket. */
export function breakdownIncome(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  services: Service[],
  appointments: Appointment[],
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  const bucket = (name: string): BreakdownRow => {
    let row = map.get(name);
    if (!row) {
      row = { id: name, name, amount: 0, count: 0 };
      map.set(name, row);
    }
    return row;
  };
  for (const t of transactions) {
    if (t.type === "income") {
      const row = bucket(incomeLabel(t, categories, services, appointments));
      row.amount += t.amount;
      row.count += 1;
    } else if (t.type === "refund") {
      const orig = t.refund_of_id
        ? transactions.find((x) => x.id === t.refund_of_id)
        : undefined;
      const name = orig
        ? incomeLabel(orig, categories, services, appointments)
        : "Возвраты";
      bucket(name).amount += signedAmount(t); // negative
    }
  }
  // Drop buckets that net to exactly 0 (a service whose in-period sales
  // were fully refunded brought nothing) — keeping them would render a
  // misleading «+€0 ×N» row. Negative «Возвраты» buckets survive.
  return Array.from(map.values())
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Expense grouped by category/note, sorted by amount desc. */
export function breakdownExpense(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const name = expenseLabel(t, categories);
    const row = map.get(name) ?? { id: name, name, amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    map.set(name, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}
