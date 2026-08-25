// Custom expense categories with icon + color.

import { generateId } from "./masters";

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string; // emoji
  color: string; // hex
}

export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "exp-fuel", name: "Бензин", icon: "⛽", color: "#f59e0b" },
  { id: "exp-materials", name: "Материалы", icon: "📦", color: "#3b82f6" },
  { id: "exp-parts", name: "Запчасти", icon: "🔧", color: "#8b5cf6" },
  { id: "exp-salary", name: "Зарплата", icon: "💰", color: "#10b981" },
  { id: "exp-rent", name: "Аренда", icon: "🏢", color: "#ef4444" },
  { id: "exp-other", name: "Прочее", icon: "📋", color: "#6b7280" },
];

const STORAGE_KEY = "babun-expense-categories";

export function loadExpenseCategories(): ExpenseCategory[] {
  if (typeof window === "undefined") return DEFAULT_EXPENSE_CATEGORIES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // v662 — DATA-LOSS GUARD: if the user explicitly deleted all
    // categories the saved value is `[]`. The old behaviour
    // ("length > 0 ? parsed : DEFAULTS") rehydrated the six seeded
    // defaults — silently reviving categories the user had wiped,
    // and on the next save they'd be persisted again. Treat the
    // presence of any persisted key (even if it parses to []) as
    // "the user has interacted with this list, respect their choice."
    // Only seed defaults when there is no key at all.
    if (raw === null) return DEFAULT_EXPENSE_CATEGORIES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_EXPENSE_CATEGORIES;
  } catch {
    return DEFAULT_EXPENSE_CATEGORIES;
  }
}

export function saveExpenseCategories(list: ExpenseCategory[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function createBlankExpenseCategory(): ExpenseCategory {
  return {
    id: generateId("exp"),
    name: "",
    icon: "📋",
    color: "#6b7280",
  };
}
