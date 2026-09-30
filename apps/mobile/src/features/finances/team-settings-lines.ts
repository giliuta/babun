import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { formatCountRu, type PluralFormsRu } from "@babun/shared/common/utils/plural-ru";
import { categoriesDoorLine } from "./category-asks";
import { hasBudget } from "./category-budget";

// ПОДПИСИ ДВЕРЕЙ «НАСТРОЕК ФИНАНСОВ» ОДНОЙ КОМАНДЫ (владелец 2026-09-24:
// «надо сделать качественные настройки в финансах по каждой команде»).
// Каждая дверь печатает состояние ВЫБРАННОЙ команды, а не компании: сколько
// её категорий и бюджетов, сколько шаблонов — не проваливаясь внутрь.

const FORMS_BUDGET: PluralFormsRu = ["бюджет", "бюджета", "бюджетов"];

/** Какая команда открыта: из адреса, если она живая; иначе первая. */
export function settingsTeamId(
  teams: readonly { id: string }[],
  requested: string | null | undefined,
): string | null {
  if (requested && teams.some((t) => t.id === requested)) return requested;
  return teams[0]?.id ?? null;
}

/** «Расход 5 · доход 2 · 1 бюджет» — категории команды и сколько у них
 *  бюджетов. Скрытые и служебные не считаются. */
export function teamCategoriesLine(
  categories: readonly FinanceCategory[],
  teamId: string | null,
): string {
  const own = categories.filter((c) => c.team_id === teamId);
  const line = categoriesDoorLine(own);
  const budgets = own.filter((c) => !c.hidden && hasBudget(c)).length;
  return budgets > 0 ? `${line} · ${formatCountRu(budgets, FORMS_BUDGET)}` : line;
}

const FORMS_CATEGORY: PluralFormsRu = ["категория", "категории", "категорий"];

/** Дверь одной страницы категорий (владелец 2026-09-30: доходы, расходы и
 *  долги — отдельными страницами): «5 категорий · 1 бюджет» либо «Пока нет».
 *  Скрытые и служебные не считаются; бюджет бывает только у расхода. */
export function teamCategoryKindLine(
  categories: readonly FinanceCategory[],
  teamId: string | null,
  kind: "income" | "expense" | "debt",
): string {
  const own = categories.filter(
    (c) => c.team_id === teamId && c.type === kind && !c.is_system && !c.hidden,
  );
  if (own.length === 0) return "Пока нет";
  const line = formatCountRu(own.length, FORMS_CATEGORY);
  const budgets = kind === "expense" ? own.filter(hasBudget).length : 0;
  return budgets > 0 ? `${line} · ${formatCountRu(budgets, FORMS_BUDGET)}` : line;
}
