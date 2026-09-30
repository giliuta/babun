// Income/expense bucketing for the «Разбор прибыли» panel — a 1:1 mirror
// of apps/web/src/lib/finance/breakdown.ts (the web lib can't be imported
// from mobile and shared doesn't export it). Pure — no side effects.

import { signedAmount } from "@babun/shared/local/finance/transaction";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import { payeeName, withPayee } from "./category-asks";
import { incomeDeals } from "./income-deals";

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
  /** Сотрудники — чтобы выплата звалась «Зарплата · Даня» и разбор делил
   *  зарплату по людям (`category-asks.ts`). */
  people?: readonly { id: string; full_name: string }[],
): string {
  const category = t.category_id
    ? categories.find((c) => c.id === t.category_id)?.name
    : undefined;
  if (category) return withPayee(category, payeeName(people, t.master_id));
  return t.notes || "Прочее";
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
  /** Визиты (или операции без визита) каждой корзины — «×N» считает их, а не
   *  платежи: предоплата и доплата одной работы — одна работа (владелец
   *  2026-09-08: «один визит — одна строка»). */
  const seen = new Map<string, Set<string>>();
  const bucket = (name: string): BreakdownRow => {
    let row = map.get(name);
    if (!row) {
      row = { id: name, name, amount: 0, count: 0 };
      map.set(name, row);
    }
    return row;
  };
  // Снятая оплата лежит парой «+50 / −50» — денег не было, и работой она не
  // считается (тот же отбор, что у плитки и ленты «Доход»).
  const deals = new Set(incomeDeals(transactions).map((t) => t.id));
  const addWork = (name: string, work: string) => {
    const works = seen.get(name) ?? new Set<string>();
    works.add(work);
    seen.set(name, works);
    bucket(name).count = works.size;
  };
  for (const t of transactions) {
    if ((t.type === "income" || t.type === "refund") && !deals.has(t.id)) continue;
    if (t.type === "income") {
      const split = serviceSplit(t, categories, services, appointments);
      if (split) {
        for (const part of split) {
          bucket(part.name).amount += part.amount;
          addWork(part.name, t.appointment_id ?? t.id);
        }
        continue;
      }
      const name = incomeLabel(t, categories, services, appointments);
      bucket(name).amount += t.amount;
      addWork(name, t.appointment_id ?? t.id);
    } else if (t.type === "refund") {
      const orig = t.refund_of_id
        ? transactions.find((x) => x.id === t.refund_of_id)
        : undefined;
      const split = orig ? serviceSplit({ ...orig, amount: signedAmount(t) }, categories, services, appointments) : null;
      if (split) {
        for (const part of split) bucket(part.name).amount += part.amount;
        continue;
      }
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
    .map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * ДОХОД ЗАПИСИ — ПО ЕЁ УСЛУГАМ (владелец 2026-09-30: «улучши прибыль»).
 * Оплата записи приходит со служебной категорией сервера «Услуги» (общей на
 * все компании), и разбор «Что принесло денег» показывал одну корзину
 * «Услуги ×N» — ни слова о том, какая работа кормит бизнес. Теперь деньги
 * записи делятся между её услугами пропорционально их сумме в записи: визит
 * «Клининг €200 + A/C Cleaning €100», оплаченный €300, даёт 200 и 100.
 * Своя категория компании (например «Чаевые» на записи) сильнее — её выбрал
 * человек. `null` — делить нечего, работает `incomeLabel`.
 */
function serviceSplit(
  t: FinanceTransaction,
  categories: FinanceCategory[],
  services: Service[],
  appointments: Appointment[],
): { name: string; amount: number }[] | null {
  if (!t.appointment_id) return null;
  if (t.category_id) {
    const c = categories.find((x) => x.id === t.category_id);
    // Своя категория компании — выбор человека; служебная общая — нет.
    if (c && c.tenant_id !== null) return null;
  }
  const a = appointments.find((x) => x.id === t.appointment_id);
  const lines = (a?.services ?? []).filter((l) => l.totalPrice > 0);
  if (lines.length === 0) return null;
  const catalog = new Map(services.map((s) => [s.id, s.name]));
  const nameOf = (l: (typeof lines)[number]) =>
    l.serviceName?.trim() || catalog.get(l.serviceId) || "Услуга";
  const total = lines.reduce((sum, l) => sum + l.totalPrice, 0);
  const cents = Math.round(t.amount * 100);
  // Делим в центах; остаток от округления — последней строке, чтобы сумма
  // частей была ровно суммой платежа.
  let left = cents;
  return lines.map((l, i) => {
    const part = i === lines.length - 1 ? left : Math.round((cents * l.totalPrice) / total);
    left -= part;
    return { name: nameOf(l), amount: part / 100 };
  });
}

/** Expense grouped by category/note, sorted by amount desc. */
export function breakdownExpense(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  people?: readonly { id: string; full_name: string }[],
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    const name = expenseLabel(t, categories, people);
    const row = map.get(name) ?? { id: name, name, amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    map.set(name, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}
