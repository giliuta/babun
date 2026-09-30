import { useMemo, type ReactElement, type ReactNode } from "react";
import { ScrollView, Text, View, type RefreshControlProps } from "react-native";
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
import { PanelHeader } from "./PanelHeader";
import { dmyShort } from "./period";
import { changeOf } from "./profit-compare";

// «Разбор прибыли» — port of the web ProfitPanel (bars view): «Доход»
// (income by service/category, breakdownIncome resolves an income tx to the
// linked appointment's service) and «Расход» (expense by category), each row
// with its ×N operation count and a proportion bar.
// Цифру самой прибыли печатает переключатель над панелью — второго раза ей
// здесь не нужно.
//
// ПЕРЕСОБРАНО 2026-09-30 (владелец: «улучшим прибыль — как показывается, что
// показывается»):
//   • в шапке — МАРЖА: сама прибыль стоит в плитке, а «хорошая ли она»
//     говорит доля от дохода — новое, а не повтор;
//   • кольцо долей снято: его подписи повторяли те же услуги, что полоски
//     под ним, — одни и те же три строки дважды. Полоски несут и долю, и
//     сумму, и «×N»;
//   • строка услуги подписана её материалами («материалы €10») — расход
//     «Материалы» перестал быть безымянной суммой;
//   • разделы — словами плиток: «Доход», «Расход»;
//   • К ПРОШЛОМУ ПЕРИОДУ — только здесь, не на плитках (владелец: «аналитику
//     такую — только в прибыли»): блок «прибыль / доход / расход — было и
//     стало» и изменение у каждой услуги и статьи расхода. Строка без пары в
//     прошлом периоде изменения не несёт: «+∞ %» ничего не говорит.
export function ProfitBreakdown({
  transactions,
  categories,
  services,
  appointments,
  materialCost,
  materialAppointmentCount,
  materialsByService,
  compare,
  only,
  title = "Прибыль",
  people,
  footer,
  refreshControl,
}: {
  transactions: FinanceTransaction[];
  categories: FinanceCategory[];
  services: Service[];
  appointments: Appointment[];
  materialCost: number;
  materialAppointmentCount: number;
  /** Материалы сделанных записей периода по услугам — подпись строки
   *  дохода (`materialsByService`). */
  materialsByService?: ReadonlyMap<string, number>;
  /** Прошлый период — только у «Прибыли» «Финансов». `null` — ещё едет. */
  compare?: {
    from: string;
    to: string;
    income: number;
    expense: number;
    profit: number;
    transactions: FinanceTransaction[];
    materialCost: number;
  } | null;
  /** Только одна половина разбора — у плиток «Доход» и «Расход» «Аналитики». */
  only?: "income" | "expense";
  title?: string;
  /** Сотрудники — зарплата делится по людям: «Зарплата · Даня». */
  people?: readonly { id: string; full_name: string }[];
  /** Секции ниже разбора — у «Аналитики» («По счетам», «Работы и оплаты»):
   *  тот же лист, та же прокрутка, те же строки. */
  footer?: ReactNode;
  /** Потянуть вниз — перечитать (у «Аналитики»). */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const th = useThemeColors();

  const incomeRows = useMemo(
    () => breakdownIncome(transactions, categories, services, appointments),
    [transactions, categories, services, appointments],
  );
  const expenseRows = useMemo(() => {
    const rows = breakdownExpense(transactions, categories, people);
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
  }, [transactions, categories, materialCost, materialAppointmentCount, people]);
  const income = incomeRows.reduce((s, r) => s + r.amount, 0);
  const expense = expenseRows.reduce((s, r) => s + r.amount, 0);
  // МАРЖА — доля прибыли в доходе, целым процентом. Без дохода её нет:
  // «−∞ %» ничего не говорит.
  const margin = income > 0 ? Math.round(((income - expense) / income) * 100) : null;
  const profit = Math.round((income - expense) * 100) / 100;

  // Прошлый период по тем же корзинам — изменение у каждой строки.
  const before = useMemo(() => {
    if (!compare) return null;
    const incomeBefore = new Map(
      breakdownIncome(compare.transactions, categories, services, appointments).map(
        (r) => [r.name, r.amount] as const,
      ),
    );
    const expenseBefore = new Map(
      breakdownExpense(compare.transactions, categories, people).map(
        (r) => [r.name, r.amount] as const,
      ),
    );
    if (compare.materialCost > 0) {
      expenseBefore.set("Материалы", (expenseBefore.get("Материалы") ?? 0) + compare.materialCost);
    }
    return { income: incomeBefore, expense: expenseBefore };
  }, [compare, categories, services, appointments, people]);
  const deltaFor = (now: number, was: number | undefined, goodUp: boolean) => {
    if (was === undefined) return undefined;
    const change = changeOf(now, was, goodUp);
    return change
      ? { text: change.text, color: change.good ? th.success : th.danger }
      : undefined;
  };
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
        note={kind === "income" ? materialsNote(materialsByService?.get(r.name)) : undefined}
        delta={deltaFor(
          r.amount,
          before?.[kind].get(r.name),
          kind === "income",
        )}
        value={`${negative ? "−" : ""}${formatEUR(Math.abs(r.amount))}`}
        color={negative ? th.danger : th.success}
        // negative rows (refunds) get no proportion bar
        share={total > 0 ? r.amount / total : 0}
      />
    );
  };

  if (empty) {
    return (
      <ScrollView style={{ flex: 1 }} refreshControl={refreshControl}>
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
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={refreshControl}
    >
      {/* Эйбрау вместо героя-карточки. Сама цифра прибыли стоит строкой выше —
          в переключателе, которым эту панель и открыли, и тем же кобальтом.
          Карточка «Прибыль за период / €900» повторяла её через 8pt: одни и те
          же деньги дважды на одном экране. */}
      {/* У половины разбора своя капс-строка («Что принесло денег») уже
          называет панель — второе имя над ней было бы повтором. */}
      {only ? null : (
        <PanelHeader
          title={title}
          right={
            margin !== null ? (
              <Text
                className="text-[13px] font-semibold"
                style={{
                  fontVariant: ["tabular-nums"],
                  color: margin < 0 ? th.danger : th.sub,
                }}
              >
                {`маржа ${margin < 0 ? "−" : ""}${Math.abs(margin)}%`}
              </Text>
            ) : undefined
          }
        />
      )}

      {/* К ПРОШЛОМУ ПЕРИОДУ — было, стало и изменение. Прибыль первой: панель
          о ней. Полоска — сейчас против большего из двух. */}
      {/* Прошлый период без денег — сравнивать не с чем: три «было €0»
          только занимали экран. */}
      {!only && compare && (compare.income !== 0 || compare.expense !== 0) ? (
        <View className="mt-1">
          <BreakdownSectionHeader
            title={`К прошлому периоду · ${dmyShort(compare.from).slice(0, 5)}–${dmyShort(compare.to)}`}
          />
          {(
            [
              { key: "profit", name: "Прибыль", now: profit, was: compare.profit, color: th.brandAccent, goodUp: true },
              { key: "income", name: "Доход", now: income, was: compare.income, color: th.success, goodUp: true },
              { key: "expense", name: "Расход", now: expense, was: compare.expense, color: th.danger, goodUp: false },
            ] as const
          ).map((c) => (
            <BreakdownBarRow
              key={c.key}
              name={c.name}
              count={0}
              note={`было ${signedEUR(c.was, c.key === "expense")}`}
              value={signedEUR(c.now, c.key === "expense")}
              color={c.now < 0 ? th.danger : c.color}
              delta={deltaFor(c.now, c.was, c.goodUp)}
              share={
                Math.max(c.now, c.was) > 0 ? Math.max(0, c.now) / Math.max(c.now, c.was) : 0
              }
            />
          ))}
        </View>
      ) : null}

      {showIncome ? (
      <View className="mt-1">
        <BreakdownSectionHeader
          title="Доход"
          value={`${income >= 0 ? "" : "−"}${formatEUR(Math.abs(income))}`}
          color={income >= 0 ? th.success : th.danger}
        />
        {incomeRows.length === 0 ? (
          <Text className="px-4 py-1.5 text-[13px]" style={{ color: th.faint }}>
            Нет доходов за период
          </Text>
        ) : (
          incomeRows.map((r) => renderRow(r, income, "income"))
        )}
      </View>
      ) : null}

      {showExpense ? (
      <View className="mt-1">
        {/* Ноль — без минуса и тише: «−€0» красным читался как долг. */}
        <BreakdownSectionHeader
          title="Расход"
          value={expense > 0 ? `−${formatEUR(expense)}` : formatEUR(0)}
          color={expense > 0 ? th.danger : th.faint}
        />
        {expenseRows.length === 0 ? (
          <Text className="px-4 py-1.5 text-[13px]" style={{ color: th.faint }}>
            Нет расходов за период
          </Text>
        ) : (
          expenseRows.map((r) => renderRow(r, expense, "expense"))
        )}
      </View>
      ) : null}
      {footer}
    </ScrollView>
  );
}

/** Сумма со знаком: расход — «−€20», отрицательная прибыль — «−€50». */
function signedEUR(amount: number, outflow: boolean): string {
  const negative = outflow ? amount > 0 : amount < 0;
  return `${negative ? "−" : ""}${formatEUR(Math.abs(amount))}`;
}

/** «материалы €10» под услугой; без материалов — ничего. */
function materialsNote(amount: number | undefined): string | undefined {
  return amount && amount > 0 ? `материалы ${formatEUR(amount)}` : undefined;
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
  note,
  delta,
}: {
  name: string;
  /** «×N» после имени; ноль — без счётчика. */
  count: number;
  value: string;
  /** Цвет суммы и полоски — цвет смысла строки. */
  color: string;
  /** Доля 0…1; вне отрезка прижимается. */
  share: number;
  /** Тихая подпись после имени — «было €593», «материалы €40». */
  note?: string;
  /** Изменение перед суммой — «↑ 23%» цветом смысла (рост или падение). */
  delta?: { text: string; color: string };
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
        {note ? (
          <Text
            className="ml-1.5 shrink text-xs"
            numberOfLines={1}
            style={{ color: th.faint, fontVariant: ["tabular-nums"] }}
          >
            {note}
          </Text>
        ) : null}
        {delta ? (
          <Text
            className="ml-auto pl-2.5 text-[13px] font-semibold"
            style={{ fontVariant: ["tabular-nums"], color: delta.color }}
          >
            {delta.text}
          </Text>
        ) : null}
        <Text
          className={`${delta ? "ml-2.5" : "ml-auto pl-2.5"} text-[15px] font-semibold`}
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

/** Шапка секции разбора — «ЧТО ПРИНЕСЛО ДЕНЕГ · €728». Одна на «Прибыль» и
 *  секции «Аналитики»: капс слева, итог секции её цветом справа. */
export function BreakdownSectionHeader({
  title,
  value,
  color,
}: {
  title: string;
  value?: string;
  color?: string;
}) {
  const th = useThemeColors();
  return (
    <View className="flex-row items-baseline px-4 pb-1 pt-3">
      <Text
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: th.sub }}
      >
        {title}
      </Text>
      {value ? (
        <Text
          className="ml-auto text-[13px] font-bold"
          style={{ fontVariant: ["tabular-nums"], color: color ?? th.ink }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}
