import type { ReactElement } from "react";
import { View, type RefreshControlProps } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";
import {
  BreakdownBarRow,
  BreakdownSectionHeader,
  ProfitBreakdown,
} from "../ProfitBreakdown";
import { dmyShort } from "@/lib/period";
import type { Analytics } from "./use-analytics";

/** «Доход» / «Расход» — сама `ProfitBreakdown` с хвостом аналитики. */
export function IncomeExpensePanel({
  a,
  panel,
  refreshControl,
}: {
  a: Analytics;
  panel: "income" | "expense";
  refreshControl: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  const { work, money, period, today, moneyPending, upcoming, upcomingWork } = a;
  return (
    <ProfitBreakdown
      only={panel}
      title={panel === "income" ? "Доход" : "Расход"}
      transactions={a.periodTxs}
      categories={a.categories}
      services={a.services}
      appointments={a.scopedAppointments}
      materialCost={panel === "expense" ? a.materials.amount : 0}
      materialAppointmentCount={a.materials.count}
      people={a.people}
      refreshControl={refreshControl}
      footer={
        <>
          {/* ПО СЧЕТАМ — наличные против карты: сколько денег через
              какой счёт прошло. Строки — те же, что у разбора. */}
          {(panel === "income" ? a.incomeByAccount : a.expenseByAccount).length > 0 ? (
            <View className="mt-1">
              <BreakdownSectionHeader title="По счетам" />
              {(panel === "income" ? a.incomeByAccount : a.expenseByAccount).map((r) => {
                const list = panel === "income" ? a.incomeByAccount : a.expenseByAccount;
                const total = list.reduce((sum, x) => sum + Math.max(0, x.amount), 0);
                const negative = panel === "expense" || r.amount < 0;
                return (
                  <BreakdownBarRow
                    key={r.id}
                    name={r.name}
                    count={r.count}
                    value={`${negative ? "−" : ""}${formatEUR(Math.abs(r.amount))}`}
                    color={negative ? t.danger : t.success}
                    share={total > 0 ? r.amount / total : 0}
                  />
                );
              })}
            </View>
          ) : null}
          {/* РАБОТЫ И ОПЛАТЫ — сколько сделано и сколько из этого
              пришло. Разница — деньги, которые ещё у клиентов. */}
          {panel === "income" && work.worked > 0 ? (
            <View className="mt-1">
              <BreakdownSectionHeader
                title="Работы и оплаты"
                value={formatEUR(work.worked)}
                color={t.ink}
              />
              <BreakdownBarRow
                name="Оплачено"
                count={0}
                value={formatEUR(Math.max(0, work.worked - work.owed))}
                color={t.success}
                share={Math.max(0, work.worked - work.owed) / work.worked}
              />
              <BreakdownBarRow
                name="Не оплачено"
                count={0}
                value={formatEUR(work.owed)}
                color={t.warning}
                share={work.owed / work.worked}
              />
            </View>
          ) : null}
          {/* ПРОГНОЗ ДО КОНЦА ПЕРИОДА — сколько ещё может прийти: записи
              впереди и долги за уже сделанное. Шапка — всё вместе с
              тем, что уже пришло. Только у периода, который ещё идёт. */}
          {panel === "income" && period.to >= today && !moneyPending ? (
            (() => {
              // Впереди — только НЕДОПЛАЧЕННОЕ: предоплата за будущий
              // визит уже сидит в «Уже пришло» (день операции — день
              // оплаты), и полная сумма записи считала её дважды.
              const owed = work.owed;
              const ahead = upcomingWork.owed;
              const total = money.income + owed + ahead;
              const base = Math.max(total, 0);
              return (
                <View className="mt-1">
                  <BreakdownSectionHeader
                    title={`Прогноз до ${dmyShort(period.to).slice(0, 5)}`}
                    value={formatEUR(total)}
                    color={t.success}
                  />
                  <BreakdownBarRow
                    name="Уже пришло"
                    count={0}
                    value={formatEUR(money.income)}
                    color={t.success}
                    share={base > 0 ? money.income / base : 0}
                  />
                  <BreakdownBarRow
                    name="Записи впереди"
                    count={upcoming.length}
                    value={formatEUR(ahead)}
                    color={t.accent}
                    share={base > 0 ? ahead / base : 0}
                  />
                  <BreakdownBarRow
                    name="Долги к сбору"
                    count={0}
                    value={formatEUR(owed)}
                    color={t.warning}
                    share={base > 0 ? owed / base : 0}
                  />
                </View>
              );
            })()
          ) : null}
        </>
      }
    />
  );
}
