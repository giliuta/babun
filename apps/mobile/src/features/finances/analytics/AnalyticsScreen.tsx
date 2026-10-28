import { type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  formatCountRu,
  FORMS_USLUGA,
  type PluralFormsRu,
} from "@babun/shared/common/utils/plural-ru";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useThemeColors } from "@/theme/colors";
import { ScopePeriodBar, SummaryToggle } from "../FinanceOverview";
import { PeriodPresetModal, PeriodWheelsModal } from "../PeriodSheets";
import { hoursLabel } from "./analytics-math";
import { ClientsPanel, ServicesPanel, TeamsPanel } from "./CountPanels";
import { IncomeExpensePanel } from "./IncomeExpensePanel";
import { ProfitPanel } from "./ProfitPanel";
import { useAnalytics, type AnalyticsStart, type Panel } from "./use-analytics";

export type { AnalyticsStart } from "./use-analytics";

// «АНАЛИТИКА» — ЗНАЧОК СПРАВА ВВЕРХУ «ФИНАНСОВ» И «КЛИЕНТОВ»: градация по количеству
// предоставленных услуг, по всем мастерам, по месяцам.
//
// СОБРАНА ИЗ БЛОКОВ «ФИНАНСОВ», А НЕ НАРИСОВАНА ЗАНОВО (те же блоки, новых не придумываем):
//   • шапка — `ScopePeriodBar`: та же лента команд и та же строка периода,
//     те же листы выбора периода;
//   • итоги — `SummaryToggle`, по две в ряд; тап раскрывает панель под ними,
//     второй тап — сворачивает к услугам;
//   • панели — `PanelHeader` и строки разбора «Прибыли» (`BreakdownBarRow`,
//     `IncomeShareDonut`); «Доход» и «Расход» — сама `ProfitBreakdown`.
// Деньги видит тот, кому их показывают «Финансы»; остальным — штуки и часы.
// Плиток денег у них нет вовсе, а не серые (канон «блок без права
// отсутствует»).

const FORMS_ZAPIS: PluralFormsRu = ["запись", "записи", "записей"];
const FORMS_KLIENT: PluralFormsRu = ["клиент", "клиента", "клиентов"];

export function AnalyticsScreen({ start }: { start: AnalyticsStart }) {
  const t = useThemeColors();
  const a = useAnalytics(start);
  const {
    sides,
    showMoney,
    showExpense,
    businessNow,
    period,
    setPeriod,
    panel,
    teams,
    teamId,
    apptsQuery,
    work,
    money,
    clientRows,
    moneyPending,
    toggle,
    quantity,
  } = a;
  const refreshControl = <RefreshControl refreshing={a.refreshing} onRefresh={a.refresh} />;

  const header = <ScreenHeader title="Аналитика" />;
  if (apptsQuery.data === undefined) {
    return (
      <Screen edges={["top"]}>
        {header}
        {apptsQuery.isError ? (
          <EmptyState
            state="error"
            fill
            title="Не удалось загрузить записи"
            action={{ label: "Повторить", onPress: () => void apptsQuery.refetch() }}
          />
        ) : (
          <EmptyState state="loading" fill />
        )}
      </Screen>
    );
  }

  const tile = (
    key: Panel,
    label: string,
    value: string,
    color: string,
    quiet: boolean,
    a11yValue?: string,
  ) => (
    <SummaryToggle
      label={label}
      color={color}
      value={value}
      quiet={quiet}
      a11yValue={a11yValue}
      active={panel === key}
      onPress={() => toggle(key)}
    />
  );
  const moneyText = (v: number) => (moneyPending ? "—" : formatEUR(v));
  const row = (children: ReactNode) => (
    <View className="flex-row" style={{ gap: 6 }}>
      {children}
    </View>
  );
  const recordsTile = tile("records", "Записи", String(work.records), t.ink, work.records === 0,
    formatCountRu(work.records, FORMS_ZAPIS));
  const servicesTile = tile("services", "Услуги", String(quantity), t.ink, quantity === 0,
    formatCountRu(quantity, FORMS_USLUGA));
  const clientsTile = tile("clients", "Клиенты", String(clientRows.length), t.ink, clientRows.length === 0,
    formatCountRu(clientRows.length, FORMS_KLIENT));
  const timeTile = tile("time", "Время", hoursLabel(work.minutes), t.ink, work.minutes === 0);
  const incomeTile = tile(
    "income",
    "Доход",
    moneyText(money.income),
    moneySign(money.income) < 0 ? t.danger : t.success,
    moneyPending || moneySign(money.income) === 0,
  );
  const checkTile = tile("check", "Средний чек", formatEUR(work.averageCheck), t.ink, work.checkRecords === 0);

  const listEnd = { paddingBottom: 96 };
  const panelBody =
    panel === "income" || panel === "expense" ? (
      <IncomeExpensePanel a={a} panel={panel} refreshControl={refreshControl} />
    ) : (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={listEnd} refreshControl={refreshControl}>
        {panel === "profit" ? (
          <ProfitPanel a={a} />
        ) : panel === "services" ? (
          <ServicesPanel a={a} />
        ) : panel === "clients" ? (
          <ClientsPanel a={a} />
        ) : (
          <TeamsPanel a={a} panel={panel} />
        )}
      </ScrollView>
    );

  return (
    <Screen edges={["top"]}>
      {header}
      <View style={{ flex: 1 }}>
        <ScopePeriodBar
          teams={teams}
          scopeTeamId={teamId}
          onScopeChange={a.setPickedTeam}
          deselectable
          period={period}
          onOpenPresets={() => a.setPresetOpen(true)}
          onOpenCustom={() => a.setWheelsOpen(true)}
        />

        <View className="px-4 pb-2 pt-2" style={{ gap: 6 }}>
          {showExpense ? (
            <>
              {row(
                <>
                  {incomeTile}
                  {tile("expense", "Расход", moneyText(money.expense), t.danger, moneyPending || moneySign(money.expense) === 0)}
                </>,
              )}
              {row(
                <>
                  {/* Не видна одна из сторон — нет и разницы: плитки нет. */}
                  {sides.profit
                    ? tile("profit", "Прибыль", moneyText(money.profit), t.brandAccent, moneyPending || moneySign(money.profit) === 0)
                    : null}
                  {checkTile}
                </>,
              )}
            </>
          ) : showMoney ? (
            // Без «Расходов» плиток расхода и прибыли нет вовсе (канон «блок
            // без права отсутствует»): доход и средний чек — одной строкой.
            row(
              <>
                {incomeTile}
                {checkTile}
              </>,
            )
          ) : null}
          {row(
            <>
              {servicesTile}
              {recordsTile}
            </>,
          )}
          {row(
            <>
              {clientsTile}
              {timeTile}
            </>,
          )}
        </View>

        {panelBody}
      </View>

      <PeriodPresetModal
        visible={a.presetOpen}
        current={period}
        businessNow={businessNow}
        onClose={() => a.setPresetOpen(false)}
        onApply={setPeriod}
      />
      <PeriodWheelsModal
        visible={a.wheelsOpen}
        current={period}
        onClose={() => a.setWheelsOpen(false)}
        onApply={setPeriod}
      />
    </Screen>
  );
}
