import { View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";
import { PanelHeader } from "../PanelHeader";
import { BreakdownBarRow, BreakdownSectionHeader } from "../ProfitBreakdown";
import { dmyShort } from "@/lib/period";
import { hoursLabel } from "./analytics-math";
import { compareRow, monthTrend as monthTrendRows } from "./compare-rows";
import { MonthTable, monthLabel } from "./MonthTable";
import type { Analytics } from "./use-analytics";

/** «Прибыль» — the content of the panel's scroll view. */
export function ProfitPanel({ a }: { a: Analytics }) {
  const t = useThemeColors();
  const { showMoney, moneyPending, sides, money, moneyPrev, work, workPrev, vat, prev, months } = a;
  const colors = { success: t.success, danger: t.danger };
  const cmp = (
    key: string,
    name: string,
    now: number,
    before: number,
    fmt: (v: number) => string,
    color: string,
    goodUp = true,
  ) => compareRow(key, name, now, before, fmt, color, colors, goodUp);
  const compareRows = [
    ...(showMoney && !moneyPending
      ? [
          cmp("income", "Доход", money.income, moneyPrev.income, formatEUR, t.success),
          cmp("expense", "Расход", money.expense, moneyPrev.expense, formatEUR, t.danger, false),
          ...(sides.profit
            ? [cmp("profit", "Прибыль", money.profit, moneyPrev.profit, formatEUR, t.brandAccent)]
            : []),
          cmp("worked", "Работ на", work.worked, workPrev.worked, formatEUR, t.accent),
          cmp("check", "Средний чек", work.averageCheck, workPrev.averageCheck, formatEUR, t.accent),
        ]
      : []),
    cmp("records", "Записи", work.records, workPrev.records, (v) => String(v), t.accent),
    cmp("time", "Время", work.minutes, workPrev.minutes, hoursLabel, t.accent),
  ];
  const monthTrend = monthTrendRows(months.rows, colors);
  const monthTop = Math.max(0, ...monthTrend.map((m) => m.profit));

  return (
    <>
      {/* К ПРОШЛОМУ ПЕРИОДУ — СПИСКОМ: сравнение между месяцами списком. Каждая строка:
          сейчас, было и насколько изменилось; полоска — сейчас против
          большего из двух. Расход растёт — это красное, не зелёное. */}
      <PanelHeader
        title={`К прошлому периоду · ${dmyShort(prev.from).slice(0, 5)}–${dmyShort(prev.to)}`}
      />
      {compareRows.map((c) => (
        <BreakdownBarRow
          key={c.key}
          name={c.name}
          count={0}
          note={`было ${c.before}`}
          value={c.now}
          color={c.color}
          delta={c.delta ?? undefined}
          share={c.share}
        />
      ))}

      {/* VAT ЗА ПЕРИОД — сколько отложить на налог и что остаётся от
          прибыли после него. Только если в периоде есть операции с
          налогом: у компании без VAT этих строк нет вовсе. */}
      {showMoney && a.vatSeen && !moneyPending ? (
        <View className="mt-1">
          <BreakdownSectionHeader
            title={vat.due >= 0 ? "VAT к уплате" : "VAT к возврату"}
            value={formatEUR(Math.abs(vat.due))}
            color={t.warning}
          />
          <BreakdownBarRow
            name="Начислен с дохода"
            count={0}
            value={formatEUR(vat.collected)}
            color={t.ink}
            share={vat.collected > 0 ? 1 : 0}
          />
          <BreakdownBarRow
            name="К вычету с расхода"
            count={0}
            value={`−${formatEUR(vat.paid)}`}
            color={t.ink}
            share={vat.collected > 0 ? Math.min(1, vat.paid / vat.collected) : 0}
          />
          <BreakdownBarRow
            name="Прибыль после VAT"
            count={0}
            value={formatEUR(money.profit - Math.max(0, vat.due))}
            color={t.brandAccent}
            share={
              money.profit > 0
                ? Math.max(0, money.profit - Math.max(0, vat.due)) / money.profit
                : 0
            }
          />
        </View>
      ) : null}

      <PanelHeader
        title={`${a.yearFrom === a.yearTo ? a.yearFrom : `${a.yearFrom}–${a.yearTo}`} · по месяцам`}
      />
      {/* Тап по месяцу — тот же экран за этот месяц: плитки и услуги
          перечитываются под него, как после выбора периода. */}
      <MonthTable
        rows={months.rows}
        total={months.total}
        onOpen={(m) => {
          a.setPeriod({ preset: "custom", from: m.from, to: m.to });
          a.setPanel("services");
        }}
      />

      {/* МЕСЯЦ К МЕСЯЦУ — прибыль каждого месяца и её изменение к
          предыдущему: рост и провалы видно глазом, без вычитания. */}
      {showMoney && monthTrend.length > 1 ? (
        <View className="mt-1">
          <BreakdownSectionHeader title="Месяц к месяцу · прибыль" />
          {monthTrend.map((m) => (
            <BreakdownBarRow
              key={m.key}
              name={monthLabel(m.key)}
              count={0}
              value={formatEUR(m.profit)}
              color={m.profit < 0 ? t.danger : t.brandAccent}
              delta={m.delta ?? undefined}
              share={monthTop > 0 ? Math.max(0, m.profit) / monthTop : 0}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}
