import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { formatCountRu, type PluralFormsRu } from "@babun/shared/common/utils/plural-ru";
import { categoriesDoorLine } from "./category-asks";
import { hasBudget } from "./category-budget";

// ПОДПИСИ ДВЕРЕЙ «НАСТРОЕК ФИНАНСОВ» ОДНОЙ КОМАНДЫ (владелец 2026-09-24:
// «надо сделать качественные настройки в финансах по каждой команде»).
// Каждая дверь печатает состояние ВЫБРАННОЙ команды, а не компании: сколько
// её категорий и бюджетов, сколько шаблонов — не проваливаясь внутрь.

const FORMS_BUDGET: PluralFormsRu = ["бюджет", "бюджета", "бюджетов"];
const FORMS_TEMPLATE: PluralFormsRu = ["шаблон", "шаблона", "шаблонов"];

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

/** Шаблонов нет — подпись говорит, зачем они; есть — сколько. */
export function teamTemplatesLine(count: number): string {
  return count > 0
    ? formatCountRu(count, FORMS_TEMPLATE)
    : "Повторяющиеся расходы в один тап";
}
