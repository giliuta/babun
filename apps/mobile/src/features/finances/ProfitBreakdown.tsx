import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Appointment } from "@babun/shared/local/appointments";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import type { Service } from "@/features/services/queries";
import {
  breakdownExpense,
  breakdownIncome,
  type BreakdownRow,
} from "./breakdown";
import { IncomeShareDonut } from "./IncomeShareDonut";
import { PanelHeader } from "./PanelHeader";

// «Разбор прибыли» — port of the web ProfitPanel (bars view): «Что принесло
// денег» (income by service/category, breakdownIncome resolves an income tx
// to the linked appointment's service) and «Куда ушёл расход» (expense by
// category), each row with its ×N operation count and a proportion bar.
// Цифру самой прибыли печатает переключатель над панелью — второго раза ей
// здесь не нужно.
//
// The web «Доли %» donut (FinancePieChart, the last finance surface with
// no mobile twin) now sits above the income rows as IncomeShareDonut —
// share-of-total, where the bars below carry per-row amounts and counts.
// It renders only with ≥2 positive buckets: one bucket is a full ring
// that says nothing the total line doesn't already say.
export function ProfitBreakdown({
  transactions,
  categories,
  services,
  appointments,
  materialCost,
  materialAppointmentCount,
  only,
  title = "Прибыль",
}: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  services: Service[];
  appointments: Appointment[];
  materialCost: number;
  materialAppointmentCount: number;
  /** Только одна половина разбора — у плиток «Доход» и «Расход» «Аналитики». */
  only?: "income" | "expense";
  title?: string;
}) {
  const th = useThemeColors();

  const incomeRows = useMemo(
    () => breakdownIncome(transactions, categories, services, appointments),
    [transactions, categories, services, appointments],
  );
  const expenseRows = useMemo(() => {
    const rows = breakdownExpense(transactions, categories);
    if (materialCost > 0) {
      rows.push({
        id: "appointment-material-cost",
        name: "Материалы",
        amount: materialCost,
        count: materialAppointmentCount,
      });
      rows.sort((a, b) => b.amount - a.amount);
    }
    return rows;
  }, [transactions, categories, materialCost, materialAppointmentCount]);
  const income = incomeRows.reduce((s, r) => s + r.amount, 0);
  const expense = expenseRows.reduce((s, r) => s + r.amount, 0);
  // The donut clamps negatives away (a refund bucket has no share of a
  // whole), so decide its visibility on the same clamped set it will
  // actually draw — otherwise one sale + one refund would look like two
  // buckets and render a pointless full ring.
  const positiveIncomeBuckets = incomeRows.filter((r) => r.amount > 0).length;
  const showIncome = only !== "expense";
  const showExpense = only !== "income";
  const empty =
    (!showIncome || incomeRows.length === 0) && (!showExpense || expenseRows.length === 0);

  // Expense amounts are stored positive but represent outflows → always
  // «−». Income buckets are normally «+»; a refund whose original sale
  // is outside the period leaves a negative «Возвраты» bucket → «−» red.
  const renderRow = (r: BreakdownRow, total: number, kind: "income" | "expense") => {
    const negative = kind === "expense" || r.amount < 0;
    return (
      <BreakdownBarRow
        key={`${kind}-${r.id}`}
        name={r.name}
        count={r.count}
        value={`${negative ? "−" : ""}${formatEUR(Math.abs(r.amount))}`}
        color={negative ? th.danger : th.success}
        // negative rows (refunds) get no proportion bar
        share={total > 0 ? r.amount / total : 0}
      />
    );
  };

  if (empty) {
    return (
      <ScrollView style={{ flex: 1 }}>
        <PanelHeader title={title} />
        <EmptyState
          title={
            only === "income"
              ? "Нет доходов за период"
              : only === "expense"
                ? "Нет расходов за период"
                : "Нет доходов и расходов за период"
          }
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      {/* Эйбрау вместо героя-карточки. Сама цифра прибыли стоит строкой выше —
          в переключателе, которым эту панель и открыли, и тем же кобальтом.
          Карточка «Прибыль за период / €900» повторяла её через 8pt: одни и те
          же деньги дважды на одном экране. */}
      {/* У половины разбора своя капс-строка («Что принесло денег») уже
          называет панель — второе имя над ней было бы повтором. */}
      {only ? null : <PanelHeader title={title} />}

      {showIncome ? (
      <View className="mt-1">
        <View className="flex-row items-baseline px-4 pb-1 pt-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: th.sub }}
          >
            Что принесло денег
          </Text>
          <Text
            className="ml-auto text-[13px] font-bold"
            style={{ fontVariant: ["tabular-nums"], color: income >= 0 ? th.success : th.danger }}
          >
            {income >= 0 ? "" : "−"}
            {formatEUR(Math.abs(income))}
          </Text>
        </View>
        {incomeRows.length === 0 ? (
          <Text className="px-4 py-1.5 text-[13px]" style={{ color: th.faint }}>
            Нет доходов за период
          </Text>
        ) : (
          <>
            {positiveIncomeBuckets >= 2 ? (
              <IncomeShareDonut rows={incomeRows} />
            ) : null}
            {incomeRows.map((r) => renderRow(r, income, "income"))}
          </>
        )}
      </View>
      ) : null}

      {showExpense ? (
      <View className="mt-1">
        <View className="flex-row items-baseline px-4 pb-1 pt-3">
          <Text
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: th.sub }}
          >
            Куда ушёл расход
          </Text>
          <Text
            className="ml-auto text-[13px] font-bold"
            style={{ fontVariant: ["tabular-nums"], color: th.danger }}
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
      ) : null}
    </ScrollView>
  );
}

/**
 * СТРОКА РАЗБОРА — имя, «×N», сумма справа и полоска доли под ними. Одна
 * вёрстка на «Прибыль» «Финансов» и на панели «Аналитики» (владелец
 * 2026-09-24: «бери всё созданное, не придумывай с нуля»).
 */
export function BreakdownBarRow({
  name,
  count,
  value,
  color,
  share,
}: {
  name: string;
  /** «×N» после имени; ноль — без счётчика. */
  count: number;
  value: string;
  /** Цвет суммы и полоски — цвет смысла строки. */
  color: string;
  /** Доля 0…1; вне отрезка прижимается. */
  share: number;
}) {
  const th = useThemeColors();
  const pct = Math.min(100, Math.max(0, share * 100));
  return (
    <View className="px-4 py-2.5">
      <View className="flex-row items-center">
        <Text
          className="shrink text-[15px]"
          style={{ color: th.ink }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {count > 0 ? (
          <Text className="ml-1.5 text-xs" style={{ color: th.faint }}>
            ×{count}
          </Text>
        ) : null}
        <Text
          className="ml-auto pl-2.5 text-[15px] font-semibold"
          style={{ fontVariant: ["tabular-nums"], color }}
        >
          {value}
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
}
