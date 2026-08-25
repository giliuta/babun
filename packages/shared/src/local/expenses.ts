// Finance expenses data layer.
//
// Covers all three scopes: company overhead, brigade costs, and
// appointment-level materials. Each scope subset can be queried independently.

import { generateId } from "./masters";
import type { Expense, ExpenseScope, ExpenseCategory } from "@babun/shared/db/types/finance";

export type { Expense, ExpenseScope, ExpenseCategory };

// ─── Storage ───────────────────────────────────────────────────────────

const EXPENSES_KEY = "babun2:finance:expenses";

export function loadExpenses(): Expense[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EXPENSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExpenses(list: Expense[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXPENSES_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function getExpense(id: string): Expense | undefined {
  return loadExpenses().find((e) => e.id === id);
}

export function createExpense(data: Omit<Expense, "id" | "createdAt">): Expense {
  const expense: Expense = {
    ...data,
    id: generateId("exp"),
    createdAt: new Date().toISOString(),
  };
  const list = loadExpenses();
  list.push(expense);
  saveExpenses(list);
  return expense;
}

export function updateExpense(
  id: string,
  patch: Partial<Omit<Expense, "id" | "createdAt">>
): Expense | null {
  const list = loadExpenses();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  saveExpenses(list);
  return list[idx];
}

export function deleteExpense(id: string): boolean {
  const list = loadExpenses();
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return false;
  saveExpenses(next);
  return true;
}

// ─── Filters ───────────────────────────────────────────────────────────

export interface ExpenseFilter {
  scope?: ExpenseScope;
  brigadeId?: string;
  appointmentId?: string;
  category?: ExpenseCategory;
  /** YYYY-MM-DD inclusive start */
  dateFrom?: string;
  /** YYYY-MM-DD inclusive end */
  dateTo?: string;
}

export function filterExpenses(filter: ExpenseFilter): Expense[] {
  const all = loadExpenses();
  return all.filter((e) => {
    if (filter.scope !== undefined && e.scope !== filter.scope) return false;
    if (filter.brigadeId !== undefined && e.brigadeId !== filter.brigadeId)
      return false;
    if (filter.appointmentId !== undefined && e.appointmentId !== filter.appointmentId)
      return false;
    if (filter.category !== undefined && e.category !== filter.category)
      return false;
    if (filter.dateFrom !== undefined && e.date < filter.dateFrom) return false;
    if (filter.dateTo !== undefined && e.date > filter.dateTo) return false;
    return true;
  });
}

// ─── Aggregates ────────────────────────────────────────────────────────

/** Sum of amountCents for a filtered set. */
export function sumExpensesCents(expenses: Expense[]): number {
  return expenses.reduce((acc, e) => acc + e.amountCents, 0);
}

/** Brigade total expenses in a date range (scope=brigade). */
export function brigadeExpensesTotal(brigadeId: string, dateFrom: string, dateTo: string): number {
  return sumExpensesCents(
    filterExpenses({ scope: "brigade", brigadeId, dateFrom, dateTo })
  );
}

/** Company-level expenses in a date range. */
export function companyExpensesTotal(dateFrom: string, dateTo: string): number {
  return sumExpensesCents(filterExpenses({ scope: "company", dateFrom, dateTo }));
}
