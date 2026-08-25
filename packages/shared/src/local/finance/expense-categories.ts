// STORY-003: пресет-категории расходов для ExpenseSheet.
// Quick-amounts — готовые суммы, часто встречающиеся у команд на
// Кипре: 20–50 EUR бензин, 10–30 еда, 15–60 расходники. Other —
// без пресетов (freeform).

import type { ExpenseCategoryKey } from "../day-extras";

export interface ExpenseCategoryConfig {
  label: string;
  color: string; // HEX
  /** Emoji/glyph выводится рядом с label в кнопке категории. */
  emoji: string;
  quickAmounts: number[];
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategoryKey, ExpenseCategoryConfig> = {
  fuel: {
    label: "Бензин",
    color: "#F97316",
    emoji: "⛽",
    quickAmounts: [20, 30, 40, 50],
  },
  food: {
    label: "Еда",
    color: "#F59E0B",
    emoji: "🍔",
    quickAmounts: [10, 15, 20, 30],
  },
  supplies: {
    label: "Расходники",
    color: "#8B5CF6",
    emoji: "🔧",
    quickAmounts: [15, 25, 40, 60],
  },
  other: {
    label: "Другое",
    color: "#64748B",
    emoji: "📦",
    quickAmounts: [],
  },
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategoryKey[] = [
  "fuel",
  "food",
  "supplies",
  "other",
];
