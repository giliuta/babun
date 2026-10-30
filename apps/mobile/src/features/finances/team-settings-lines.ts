import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { formatCountRu, type PluralFormsRu } from "@babun/shared/common/utils/plural-ru";
import { hasBudget } from "./category-budget";

// ПОДПИСИ ДВЕРЕЙ «НАСТРОЕК ФИНАНСОВ» ОДНОЙ КОМАНДЫ: настройки финансов свои у
// каждой команды.
// Каждая дверь печатает состояние ВЫБРАННОЙ команды, а не компании: сколько
// её категорий и бюджетов, сколько шаблонов — не проваливаясь внутрь.

const FORMS_BUDGET: PluralFormsRu = ["бюджет", "бюджета", "бюджетов"];
const FORMS_OPERATION: PluralFormsRu = ["операция", "операции", "операций"];

/** Дверь «Удалённые операции»: «Пусто» либо «2 операции» — сколько
 *  в ящике у выбранной команды. */
export function deletedOperationsDoorLine(count: number): string {
  return count > 0 ? formatCountRu(count, FORMS_OPERATION) : "Пусто";
}

/** Какая команда открыта: из адреса, если она живая; иначе первая. */
export function settingsTeamId(
  teams: readonly { id: string }[],
  requested: string | null | undefined,
): string | null {
  if (requested && teams.some((t) => t.id === requested)) return requested;
  return teams[0]?.id ?? null;
}

/** ДВЕРЬ «СЧЕТА: ПОРЯДОК И НАСТРОЙКИ» НАД ПЛИТКАМИ СЧЕТОВ: из счетов команды —
 *  настройки именно её счетов. Выбрана команда — страница открывается на ней одной (`?team=`);
 *  «Без команды» и «все» — страница всех счетов. */
export function accountsSettingsHref(teamId: string | null, noTeam: string): string {
  return teamId && teamId !== noTeam
    ? `/accounts/settings?team=${encodeURIComponent(teamId)}`
    : "/accounts/settings";
}

const FORMS_CATEGORY: PluralFormsRu = ["категория", "категории", "категорий"];

/** Дверь одной страницы категорий (доходы, расходы и
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
