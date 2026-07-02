import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";

type Row = { id: string; amt: number };

// Bucket for refunds whose original income is outside the period/scope
// (web parity: breakdownIncome's «Возвраты» bucket).
const ORPHAN_REFUNDS = "__refunds__";

// Income / expense broken down by category, with a profit hero and per-row
// proportion bars. Read-only view over the period's transactions.
export function ProfitBreakdown({
  transactions,
  categories,
}: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
}) {
  const th = useThemeColors();
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const { incomeRows, expenseRows, income, expense } = useMemo(() => {
    const inc = new Map<string, number>();
    const exp = new Map<string, number>();
    const byId = new Map(transactions.map((t) => [t.id, t]));
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      const key = t.category_id ?? "—";
      if (t.type === "income") {
        inc.set(key, (inc.get(key) ?? 0) + t.amount);
        income += t.amount;
      } else if (t.type === "expense") {
        exp.set(key, (exp.get(key) ?? 0) + t.amount);
        expense += t.amount;
      } else if (t.type === "refund") {
        // Web parity (breakdownIncome): a refund is netted back into the
        // bucket of the income it reverses, so «Доходы» equals net income
        // and income − expense reconciles to «Прибыль». Orphan refunds
        // (original income outside the period) go to «Возвраты».
        const orig = t.refund_of_id ? byId.get(t.refund_of_id) : undefined;
        const k =
          orig && orig.type === "income"
            ? orig.category_id ?? "—"
            : ORPHAN_REFUNDS;
        const signed = signedAmount(t); // negative
        inc.set(k, (inc.get(k) ?? 0) + signed);
        income += signed;
      }
    }
    const toRows = (m: Map<string, number>): Row[] =>
      [...m.entries()]
        .map(([id, amt]) => ({ id, amt }))
        .sort((a, b) => b.amt - a.amt);
    return {
      // drop buckets whose in-period sales were fully refunded (net 0) —
      // a «+€0» row would mislead; negative «Возвраты» rows survive
      incomeRows: toRows(inc).filter((r) => r.amt !== 0),
      expenseRows: toRows(exp),
      income,
      expense,
    };
  }, [transactions]);

  const renderRow = (r: Row, total: number, color: string) => {
    const c =
      r.id === "—" || r.id === ORPHAN_REFUNDS ? null : catById.get(r.id);
    // negative rows (refunds) get no proportion bar
    const pct = total > 0 ? Math.max(0, (r.amt / total) * 100) : 0;
    return (
      <View key={`${color}-${r.id}`} className="px-4 py-2.5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            {c?.color ? (
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: c.color }}
              />
            ) : null}
            <Text className="text-base" style={{ color: th.ink }}>
              {r.id === ORPHAN_REFUNDS
                ? "Возвраты"
                : c?.name ?? "Без категории"}
            </Text>
          </View>
          <Text className="text-base font-semibold tabular-nums" style={{ color }}>
            {formatEUR(r.amt)}
          </Text>
        </View>
        <View className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: th.separator }}>
          <View
            className="h-1.5 rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </View>
      </View>
    );
  };

  if (income === 0 && expense === 0) {
    return <EmptyState fill title="Нет данных за период" />;
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <View className="mx-3 mt-2 rounded-2xl p-4 shadow-sm" style={{ backgroundColor: th.surface }}>
        <Text className="text-xs" style={{ color: th.sub }}>Прибыль за период</Text>
        <Text
          className="text-3xl font-bold"
          style={{ color: th.brandAccent }}
        >
          {formatEUR(income - expense)}
        </Text>
      </View>

      {expenseRows.length > 0 ? (
        <View className="mt-1">
          <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider" style={{ color: th.sub }}>
            Расходы · {formatEUR(expense)}
          </Text>
          {expenseRows.map((r) => renderRow(r, expense, th.danger))}
        </View>
      ) : null}

      {incomeRows.length > 0 ? (
        <View className="mt-1">
          <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider" style={{ color: th.sub }}>
            Доходы · {formatEUR(income)}
          </Text>
          {incomeRows.map((r) => renderRow(r, income, th.success))}
        </View>
      ) : null}
    </ScrollView>
  );
}
