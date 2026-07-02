import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Appointment } from "@babun/shared/local/appointments";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import type { Service } from "@/features/services/queries";
import {
  breakdownExpense,
  breakdownIncome,
  type BreakdownRow,
} from "./breakdown";

// «Разбор прибыли» — port of the web ProfitPanel (bars view): profit hero,
// then «Что принесло денег» (income by service/category, breakdownIncome
// resolves an income tx to the linked appointment's service) and «Куда
// ушёл расход» (expense by category), each row with its ×N operation
// count and a proportion bar. The web «Доли %» donut toggle is deferred.
export function ProfitBreakdown({
  transactions,
  categories,
  services,
  appointments,
}: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  services: Service[];
  appointments: Appointment[];
}) {
  const th = useThemeColors();

  const incomeRows = useMemo(
    () => breakdownIncome(transactions, categories, services, appointments),
    [transactions, categories, services, appointments],
  );
  const expenseRows = useMemo(
    () => breakdownExpense(transactions, categories),
    [transactions, categories],
  );
  const income = incomeRows.reduce((s, r) => s + r.amount, 0);
  const expense = expenseRows.reduce((s, r) => s + r.amount, 0);

  if (incomeRows.length === 0 && expenseRows.length === 0) {
    return <EmptyState fill title="Нет данных за период" />;
  }

  // Expense amounts are stored positive but represent outflows → always
  // «−». Income buckets are normally «+»; a refund whose original sale
  // is outside the period leaves a negative «Возвраты» bucket → «−» red.
  const renderRow = (r: BreakdownRow, total: number, kind: "income" | "expense") => {
    const color =
      kind === "expense" || r.amount < 0 ? th.danger : th.success;
    const sign = kind === "expense" || r.amount < 0 ? "−" : "+";
    // negative rows (refunds) get no proportion bar
    const pct = total > 0 ? Math.min(100, Math.max(0, (r.amount / total) * 100)) : 0;
    return (
      <View key={`${kind}-${r.id}`} className="px-4 py-2.5">
        <View className="flex-row items-center">
          <Text
            className="shrink text-[15px]"
            style={{ color: th.ink }}
            numberOfLines={1}
          >
            {r.name}
          </Text>
          {r.count > 0 ? (
            <Text className="ml-1.5 text-xs" style={{ color: th.faint }}>
              ×{r.count}
            </Text>
          ) : null}
          <Text
            className="ml-auto pl-2.5 text-[15px] font-semibold tabular-nums"
            style={{ color }}
          >
            {sign}
            {formatEUR(Math.abs(r.amount))}
          </Text>
        </View>
        <View
          className="mt-1.5 h-1.5 overflow-hidden rounded-full"
          style={{ backgroundColor: th.separator }}
        >
          <View
            className="h-1.5 rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 16 }}>
        <Text className="text-xs" style={{ color: th.sub }}>
          Прибыль за период
        </Text>
        <Text className="text-3xl font-bold" style={{ color: th.brandAccent }}>
          {formatEUR(income - expense)}
        </Text>
      </Card>

      <View className="mt-1">
        <View className="flex-row items-baseline px-4 pb-1 pt-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: th.sub }}
          >
            Что принесло денег
          </Text>
          <Text
            className="ml-auto text-[13px] font-bold tabular-nums"
            style={{ color: income >= 0 ? th.success : th.danger }}
          >
            {income >= 0 ? "+" : "−"}
            {formatEUR(Math.abs(income))}
          </Text>
        </View>
        {incomeRows.length === 0 ? (
          <Text className="px-4 py-1.5 text-[13px]" style={{ color: th.faint }}>
            Нет доходов за период
          </Text>
        ) : (
          incomeRows.map((r) => renderRow(r, income, "income"))
        )}
      </View>

      <View className="mt-1">
        <View className="flex-row items-baseline px-4 pb-1 pt-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: th.sub }}
          >
            Куда ушёл расход
          </Text>
          <Text
            className="ml-auto text-[13px] font-bold tabular-nums"
            style={{ color: th.danger }}
          >
            −{formatEUR(expense)}
          </Text>
        </View>
        {expenseRows.length === 0 ? (
          <Text className="px-4 py-1.5 text-[13px]" style={{ color: th.faint }}>
            Нет расходов за период
          </Text>
        ) : (
          expenseRows.map((r) => renderRow(r, expense, "expense"))
        )}
      </View>
    </ScrollView>
  );
}
