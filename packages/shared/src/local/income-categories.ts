// Custom income categories with icon + color. Mirrors expense-categories.ts
// shape so the shared FinanceCategoriesSheet can manage both lists with
// the same row UI.
//
// Brief (CRM Core, P0 #11): defaults are Услуги / Товары / Чаевые /
// Возврат / Иное. The tenant can rename, recolour, delete, and add
// freely; bootstrap only seeds the empty state.

import { generateId } from "./masters";

export interface IncomeCategory {
  id: string;
  name: string;
  icon: string; // emoji
  color: string; // hex
}

export const DEFAULT_INCOME_CATEGORIES: IncomeCategory[] = [
  { id: "inc-services", name: "Услуги", icon: "⚙", color: "#10b981" },
  { id: "inc-goods", name: "Товары", icon: "📦", color: "#3b82f6" },
  { id: "inc-tips", name: "Чаевые", icon: "💰", color: "#f59e0b" },
  { id: "inc-refund", name: "Возврат", icon: "↩", color: "#ef4444" },
  { id: "inc-other", name: "Иное", icon: "📋", color: "#6b7280" },
];

const STORAGE_KEY = "babun-income-categories";

export function loadIncomeCategories(): IncomeCategory[] {
  if (typeof window === "undefined") return DEFAULT_INCOME_CATEGORIES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // v662 — DATA-LOSS GUARD: same pattern as expense-categories.
    // Only seed defaults when there is no key at all; respect an
    // explicit empty array as the user's choice.
    if (raw === null) return DEFAULT_INCOME_CATEGORIES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_INCOME_CATEGORIES;
  } catch {
    return DEFAULT_INCOME_CATEGORIES;
  }
}

export function saveIncomeCategories(list: IncomeCategory[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function createBlankIncomeCategory(): IncomeCategory {
  return {
    id: generateId("inc"),
    name: "",
    icon: "📋",
    color: "#6b7280",
  };
}
