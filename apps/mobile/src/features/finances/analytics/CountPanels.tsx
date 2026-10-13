import { Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { IncomeShareDonut } from "../IncomeShareDonut";
import { PanelHeader, panelCount } from "../PanelHeader";
import { BreakdownBarRow, BreakdownSectionHeader } from "../ProfitBreakdown";
import { hoursLabel } from "./analytics-math";
import type { Analytics } from "./use-analytics";

const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const empty = () => <EmptyState title="За период работ нет" />;

/** «Услуги» — the content of the panel's scroll view. */
export function ServicesPanel({ a }: { a: Analytics }) {
  const t = useThemeColors();
  const { showMoney, serviceRows, serviceProfitRows, work, quantity } = a;
  return (
    <>
      <PanelHeader title={panelCount("Услуги", quantity)} />
      {serviceRows.length === 0 ? (
        empty()
      ) : (
        <>
          {showMoney && serviceRows.filter((r) => r.amount > 0).length >= 2 ? (
            <IncomeShareDonut
              rows={serviceRows.map((r) => ({
                id: r.id,
                name: r.name,
                amount: r.amount,
                count: r.quantity,
              }))}
            />
          ) : null}
          {serviceRows.map((r) => (
            <BreakdownBarRow
              key={r.id}
              name={r.name}
              count={r.quantity}
              value={showMoney ? formatEUR(r.amount) : `${r.quantity} шт`}
              color={t.accent}
              share={
                showMoney
                  ? work.worked > 0 ? r.amount / work.worked : 0
                  : quantity > 0 ? r.quantity / quantity : 0
              }
            />
          ))}
          {/* ПРИБЫЛЬ ПО УСЛУГАМ — работы минус материалы услуги: что
              реально выгодно, а не только что дорого стоит. Материалы —
              расход: без «Расходов» блока нет. */}
          {a.showExpense ? (
            <View className="mt-1">
              <BreakdownSectionHeader
                title="Прибыль по услугам"
                value={formatEUR(serviceProfitRows.reduce((sum, r) => sum + r.profit, 0))}
                color={t.brandAccent}
              />
              {(() => {
                const top = Math.max(0, ...serviceProfitRows.map((r) => r.profit));
                return serviceProfitRows.map((r) => (
                  <BreakdownBarRow
                    key={r.id}
                    name={r.name}
                    count={0}
                    note={r.materials > 0 ? `материалы ${formatEUR(r.materials)}` : undefined}
                    value={formatEUR(r.profit)}
                    color={r.profit < 0 ? t.danger : t.brandAccent}
                    share={top > 0 ? Math.max(0, r.profit) / top : 0}
                  />
                ));
              })()}
            </View>
          ) : null}
        </>
      )}
    </>
  );
}

/** «Клиенты» — the content of the panel's scroll view. */
export function ClientsPanel({ a }: { a: Analytics }) {
  const t = useThemeColors();
  const { showMoney, clientRows, clientName, work } = a;
  return (
    <>
      <PanelHeader title={panelCount("Клиенты", clientRows.length)} />
      {clientRows.length === 0
        ? empty()
        : clientRows.map((c) => (
            <BreakdownBarRow
              key={c.id}
              name={clientName.get(c.id) ?? "Клиент удалён"}
              count={c.records}
              value={showMoney ? formatEUR(c.worked) : String(c.records)}
              color={t.accent}
              share={
                showMoney
                  ? work.worked > 0 ? c.worked / work.worked : 0
                  : work.records > 0 ? c.records / work.records : 0
              }
            />
          ))}
    </>
  );
}

/** «Записи», «Средний чек», «Время» — one team comparison, three measures. */
export function TeamsPanel({ a, panel }: { a: Analytics; panel: "records" | "check" | "time" }) {
  const t = useThemeColors();
  const { showMoney, teamRows, teamId, work, weekdays, cancelled } = a;
  // ОДНИ И ТЕ ЖЕ КОМАНДЫ, ТРИ ВОПРОСА: на сколько работ, какой
  // средний чек, сколько часов. Какой — говорит плитка, которой открыли.
  const measure = (r: (typeof teamRows)[number]) =>
    panel === "time" ? r.minutes : panel === "check" ? r.averageCheck : showMoney ? r.worked : r.records;
  const max = Math.max(0, ...teamRows.map(measure));
  const perHour = showMoney && work.perHour !== null ? `${formatEUR(work.perHour)} / ч` : null;
  return (
    <>
      <PanelHeader
        // Панель одна на три плитки — шапка называет, ЧТО сравнивается
        // (аудит 2026-09-24): иначе, пролистав, не понять, часы это
        // или записи.
        title={`${panelCount("Команды", teamRows.length)} · ${
          panel === "time" ? "часы" : panel === "check" ? "средний чек" : "записи"
        }`}
        right={
          panel === "time" && perHour ? (
            <Text
              className="text-[13px] font-semibold"
              style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
            >
              {perHour}
            </Text>
          ) : panel === "records" && cancelled > 0 ? (
            <Text
              className="text-[13px] font-semibold"
              style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
            >
              {`отменено ${cancelled}`}
            </Text>
          ) : undefined
        }
      />
      {teamRows.length === 0
        ? empty()
        : teamRows.map((r) => (
            <BreakdownBarRow
              key={r.id}
              name={r.name}
              count={r.records}
              value={
                panel === "time"
                  ? hoursLabel(r.minutes)
                  : panel === "check"
                    ? formatEUR(r.averageCheck)
                    : showMoney
                      ? formatEUR(r.worked)
                      : String(r.records)
              }
              // Выбранная команда — акцентом, остальные тише; без выбора
              // акцентом все: сравниваются равные.
              color={teamId === null || r.id === teamId ? t.accent : t.sub}
              share={max > 0 ? measure(r) / max : 0}
            />
          ))}
      {/* ПО ДНЯМ НЕДЕЛИ — когда забито, когда пусто. Только у «Времени»:
          это вопрос о загрузке, а не о деньгах. */}
      {panel === "time" && work.records > 0 ? (
        <View className="mt-1">
          <BreakdownSectionHeader title="По дням недели" />
          {(() => {
            const top = Math.max(0, ...weekdays.map((w) => w.minutes));
            return weekdays.map((w) => (
              <BreakdownBarRow
                key={w.day}
                name={WEEKDAYS[w.day]}
                count={w.records}
                value={w.minutes > 0 ? hoursLabel(w.minutes) : "—"}
                color={t.accent}
                share={top > 0 ? w.minutes / top : 0}
              />
            ));
          })()}
        </View>
      ) : null}
    </>
  );
}
