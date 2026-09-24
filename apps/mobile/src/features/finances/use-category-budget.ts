import { useEffect, useMemo } from "react";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { money } from "@babun/shared/common/utils/money";
import { useTenantId } from "@/lib/tenant";
import { todayYmd } from "@/features/invoices/format";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole } from "@/features/settings/tenant";
import { useCurrency } from "@/features/settings/currency";
import { useFinanceCategories, useTransactions } from "./queries";
import { runBudgetAlerts } from "./budget-notify";
import {
  budgetLeftLine,
  hasBudget,
  monthOf,
  monthSpendByCategory,
} from "./category-budget";

// БЮДЖЕТЫ НА ЭКРАНАХ. Потрачено за месяц берётся из того же среза журнала
// компании за месяц, что у «Финансов» (`useTransactions` без отбора): открытая
// страница денег уже держит его в кэше, а любая запись в журнал роняет его
// вместе со всем `["transactions"]`, и цифры бюджета приходят свежими сами.
//
// Только ВЛАДЕЛЬЦУ: у сотрудника журнал урезан правами, и «осталось €70»
// по его куску было бы неправдой.

function useBudgetMonth(enabled: boolean) {
  const settings = useCalendarSettings();
  const month = monthOf(todayYmd(settings.data?.timezone ?? "Europe/Nicosia"));
  const ledger = useTransactions(month.from, month.to, { enabled });
  const rows = ledger.isPlaceholderData ? undefined : ledger.data;
  const spend = useMemo(
    () => (enabled && rows ? monthSpendByCategory(rows) : null),
    [enabled, rows],
  );
  return { month, spend };
}

/** Потрачено за месяц по категориям — для справочника. `null`, пока грузится. */
export function useCategoryMonthSpend(enabled = true) {
  return useBudgetMonth(enabled).spend;
}

/** Строка под выбранной категорией в форме операции: «Бюджет: осталось …». */
export function useCategoryBudgetLine(
  category: FinanceCategory | null | undefined,
): string | null {
  const owner = useCurrentRole().data === "owner";
  const active = owner && !!category && hasBudget(category);
  const { spend } = useBudgetMonth(active);
  const currency = useCurrency();
  if (!active || !spend || !category?.monthly_budget) return null;
  return budgetLeftLine(
    spend.get(category.id) ?? 0,
    category.monthly_budget,
    (n) => money(n, currency),
  );
}

/** Сторож бюджетов, пока открыт раздел «Финансы»: владелец узнаёт и о
 *  расходах, внесённых с чужих телефонов. Один раз на порог за месяц. */
export function useBudgetWatch(): void {
  const tenantId = useTenantId();
  const owner = useCurrentRole().data === "owner";
  const categories = useFinanceCategories().data;
  const anyBudget = owner && !!categories?.some(hasBudget);
  const { month, spend } = useBudgetMonth(anyBudget);
  useEffect(() => {
    if (!tenantId || !anyBudget || !spend || !categories) return;
    void runBudgetAlerts(tenantId, categories, spend, month.key);
  }, [tenantId, anyBudget, spend, categories, month.key]);
}
