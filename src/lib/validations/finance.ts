import { z } from "zod";

export const expenseCategories = [
  "fuel",
  "materials",
  "equipment",
  "ads",
  "rent",
  "salary",
  "tax",
  "insurance",
  "other",
] as const;

export const categoryLabels: Record<string, string> = {
  fuel: "Топливо",
  materials: "Материалы",
  equipment: "Оборудование",
  ads: "Реклама",
  rent: "Аренда",
  salary: "Зарплата",
  tax: "Налоги",
  insurance: "Страховка",
  other: "Прочее",
};

export const createExpenseSchema = z.object({
  category: z.enum(expenseCategories),
  amount: z.number().min(0.01),
  description: z.string().optional(),
  date: z.string(),
  crew_id: z.string().uuid().optional(),
});

export const createSalarySchema = z.object({
  profile_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  base_amount: z.number().min(0),
  bonus_amount: z.number().min(0).default(0),
  deductions: z.number().min(0).default(0),
  total: z.number().min(0),
  notes: z.string().optional(),
});
