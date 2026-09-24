import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  formatCountRu,
  FORMS_USLUGA,
  type PluralFormsRu,
} from "@babun/shared/common/utils/plural-ru";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useThemeColors } from "@/theme/colors";
import { useMyAccess } from "@/features/access/queries";
import { bestCalendarLevel } from "@/features/access/my-access";
import { useAppointments, useFinanceServices } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { todayYmd } from "@/features/invoices/format";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useCurrentRole } from "@/features/settings/tenant";
import { useAccountsWithBalances } from "../accounts";
import { ScopePeriodBar, SummaryToggle } from "../FinanceOverview";
import { IncomeShareDonut } from "../IncomeShareDonut";
import { PanelHeader, panelCount } from "../PanelHeader";
import { PeriodPresetModal, PeriodWheelsModal } from "../PeriodSheets";
import {
  BreakdownBarRow,
  BreakdownSectionHeader,
  ProfitBreakdown,
} from "../ProfitBreakdown";
import { makePeriod, type Period } from "../period";
import { useFinanceCategories, useTransactions } from "../queries";
import {
  accountBreakdown,
  cancelledCount,
  clientBreakdown,
  hoursLabel,
  ledgerInScope,
  materialTotals,
  moneyTotals,
  monthTable,
  performedRecords,
  serviceBreakdown,
  teamBreakdown,
  weekdayLoad,
  workTotals,
  type Scope,
} from "./analytics-math";
import { MonthTable } from "./MonthTable";

// «АНАЛИТИКА» — ЗНАЧОК СПРАВА ВВЕРХУ «ФИНАНСОВ» И «КЛИЕНТОВ» (владелец
// 2026-09-24, по образцу старого приложения: «градация по количеству
// предоставленных услуг, по всем мастерам, по месяцам — продумай на максимум»).
//
// СОБРАНА ИЗ БЛОКОВ «ФИНАНСОВ», А НЕ НАРИСОВАНА ЗАНОВО (владелец в тот же
// день: «всю нашу настройку, которую мы использовали в финансах, такую же
// используй в аналитике, не надо новые блоки придумывать»):
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
const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

type Panel =
  | "income"
  | "expense"
  | "profit"
  | "check"
  | "services"
  | "records"
  | "clients"
  | "time";

export interface AnalyticsStart {
  period: Period | null;
  teamId: string | null;
}

export function AnalyticsScreen({ start }: { start: AnalyticsStart }) {
  const t = useThemeColors();
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  const moneyLevel = myAccess ? bestCalendarLevel(myAccess, "finance.operations") : undefined;
  // ДЕНЬГИ — ПО ФИНАНСОВОМУ ПРАВУ (как было у «Сводки» с 20.09): записи
  // диспетчеру приходят с суммами, и выручка компании не должна утекать мимо
  // блока «Доходы и расходы».
  const showMoney = role === "owner" || moneyLevel === "read" || moneyLevel === "write";

  const calendarSettings = useCalendarSettings().data;
  const timezone = calendarSettings?.timezone ?? "Europe/Nicosia";
  const businessNow = calendarSettings?.timezone
    ? getCurrentTimeInZone(timezone)
    : getCurrentCyprusTime();
  const today = todayYmd(timezone);
  // «Сейчас» для сегодняшних записей: сделана — когда её время кончилось.
  const nowHm = `${String(businessNow.getHours()).padStart(2, "0")}:${String(
    businessNow.getMinutes(),
  ).padStart(2, "0")}`;

  const [period, setPeriod] = useState<Period>(
    () => start.period ?? makePeriod("month", businessNow),
  );
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  /** `undefined` — ещё не выбирали: команда, с которой пришли, иначе первая;
   *  `null` — «Все команды»; строка — команда. */
  const [pickedTeam, setPickedTeam] = useState<string | null | undefined>(
    start.teamId ?? undefined,
  );
  const [panel, setPanel] = useState<Panel>("services");

  const teamsData = useTeams().data;
  const teams = useMemo(() => teamsData ?? [], [teamsData]);
  // СРЕЗ: «Все команды» (`null`, владелец 2026-09-24: «аналитика может быть
  // по всем командам») или команда. Пришли с командой — она; нет или её
  // удалили (ушли в другую компанию) — первая живая, как на «Финансах».
  const teamId =
    pickedTeam === null
      ? null
      : teams.some((team) => team.id === pickedTeam)
        ? (pickedTeam as string)
        : (teams[0]?.id ?? null);

  const apptsQuery = useAppointments();
  const appointments = useMemo(() => apptsQuery.data ?? [], [apptsQuery.data]);
  const clientsData = useClients().data;
  const clientName = useMemo(
    () => new Map((clientsData ?? []).map((c) => [c.id, c.full_name])),
    [clientsData],
  );
  const allServices = useAllServices().data;
  const services = useMemo(() => allServices ?? [], [allServices]);
  const financeServices = useFinanceServices();
  const catalog = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const peopleData = useMasters({ includeInactive: true }).data;
  const people = useMemo(() => peopleData ?? [], [peopleData]);
  const categoriesData = useFinanceCategories().data;
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);
  const accountsData = useAccountsWithBalances({ includeInactive: true }).data;
  const accountTeam = useMemo(
    () => new Map((accountsData ?? []).map((a) => [a.id, a.brigade_id ?? null] as const)),
    [accountsData],
  );

  // ОДИН ЗАПРОС ЖУРНАЛА НА ВСЁ: период и все его годы для таблицы по месяцам
  // (период через новый год — оба года).
  const yearFrom = Number(period.from.slice(0, 4));
  const yearTo = Number(period.to.slice(0, 4));
  const yearEnd = `${yearTo}-12-31`;
  const ledgerFrom = [period.from, `${yearFrom}-01-01`].sort()[0];
  const ledgerTo = [period.to, yearEnd < today ? yearEnd : today].sort()[1];
  const ledger = useTransactions(ledgerFrom, ledgerTo, { enabled: showMoney });
  const txs = useMemo(() => ledger.data ?? [], [ledger.data]);

  const scope: Scope = useMemo(
    () => ({ from: period.from, to: period.to, today, teamId, accountTeam, nowHm }),
    [period.from, period.to, today, teamId, accountTeam, nowHm],
  );
  const records = useMemo(() => performedRecords(appointments, scope), [appointments, scope]);
  const work = useMemo(() => workTotals(records), [records]);
  const money = useMemo(
    () => moneyTotals(txs, appointments, financeServices, scope),
    [txs, appointments, financeServices, scope],
  );
  const periodTxs = useMemo(() => ledgerInScope(txs, scope), [txs, scope]);
  const materials = useMemo(
    () => materialTotals(appointments, financeServices, scope),
    [appointments, financeServices, scope],
  );
  const serviceRows = useMemo(() => serviceBreakdown(records, catalog), [records, catalog]);
  const clientRows = useMemo(() => clientBreakdown(records), [records]);
  // КОМАНДЫ СРАВНИВАЮТСЯ МЕЖДУ СОБОЙ — «по всем мастерам»: панель берёт весь
  // период компании, а не только выбранный чип, иначе в ней была бы одна строка.
  const teamRows = useMemo(
    () => teamBreakdown(performedRecords(appointments, { ...scope, teamId: null }), teams),
    [appointments, scope, teams],
  );
  const months = useMemo(
    () =>
      monthTable({ from: yearFrom, to: yearTo }, txs, appointments, financeServices, {
        today,
        teamId,
        accountTeam,
        nowHm,
      }),
    [yearFrom, yearTo, txs, appointments, financeServices, today, teamId, accountTeam, nowHm],
  );
  const accountsList = useMemo(() => accountsData ?? [], [accountsData]);
  const incomeByAccount = useMemo(
    () => accountBreakdown(periodTxs, "income", accountsList),
    [periodTxs, accountsList],
  );
  const expenseByAccount = useMemo(
    () => accountBreakdown(periodTxs, "expense", accountsList),
    [periodTxs, accountsList],
  );
  const weekdays = useMemo(() => weekdayLoad(records), [records]);
  const cancelled = useMemo(() => cancelledCount(appointments, scope), [appointments, scope]);
  // ДЕНЬГИ ЕЩЁ ЕДУТ — плитка говорит «—», а не «€0»: ноль выглядел бы фактом
  // (аудит 2026-09-24), хотя журнал просто не доехал.
  const moneyPending = showMoney && ledger.data === undefined;
  const scopedAppointments = useMemo(
    () => appointments.filter((a) => teamId === null || a.team_id === teamId),
    [appointments, teamId],
  );

  const toggle = (next: Panel) => setPanel((cur) => (cur === next ? "services" : next));
  const quantity = serviceRows.reduce((s, r) => s + r.quantity, 0);

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

  const listEnd = { paddingBottom: 96 };
  const empty = <EmptyState title="За период работ нет" />;

  const panelBody = (() => {
    switch (panel) {
      case "income":
      case "expense":
        return (
          <ProfitBreakdown
            only={panel}
            title={panel === "income" ? "Доход" : "Расход"}
            transactions={periodTxs}
            categories={categories}
            services={services}
            appointments={scopedAppointments}
            materialCost={panel === "expense" ? materials.amount : 0}
            materialAppointmentCount={materials.count}
            people={people}
            footer={
              <>
                {/* ПО СЧЕТАМ — наличные против карты: сколько денег через
                    какой счёт прошло. Строки — те же, что у разбора. */}
                {(panel === "income" ? incomeByAccount : expenseByAccount).length > 0 ? (
                  <View className="mt-1">
                    <BreakdownSectionHeader title="По счетам" />
                    {(panel === "income" ? incomeByAccount : expenseByAccount).map((r) => {
                      const list = panel === "income" ? incomeByAccount : expenseByAccount;
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
                      value={formatEUR(Math.min(work.paid, work.worked))}
                      color={t.success}
                      share={work.paid / work.worked}
                    />
                    <BreakdownBarRow
                      name="Не оплачено"
                      count={0}
                      value={formatEUR(Math.max(0, work.worked - work.paid))}
                      color={t.warning}
                      share={Math.max(0, work.worked - work.paid) / work.worked}
                    />
                  </View>
                ) : null}
              </>
            }
          />
        );
      case "profit":
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={listEnd}>
            <PanelHeader
              title={`${yearFrom === yearTo ? yearFrom : `${yearFrom}–${yearTo}`} · по месяцам`}
            />
            {/* Тап по месяцу — тот же экран за этот месяц: плитки и услуги
                перечитываются под него, как после выбора периода. */}
            <MonthTable
              rows={months.rows}
              total={months.total}
              onOpen={(m) => {
                setPeriod({ preset: "custom", from: m.from, to: m.to });
                setPanel("services");
              }}
            />
          </ScrollView>
        );
      case "services":
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={listEnd}>
            <PanelHeader title={panelCount("Услуги", quantity)} />
            {serviceRows.length === 0 ? (
              empty
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
              </>
            )}
          </ScrollView>
        );
      case "clients":
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={listEnd}>
            <PanelHeader title={panelCount("Клиенты", clientRows.length)} />
            {clientRows.length === 0
              ? empty
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
          </ScrollView>
        );
      case "records":
      case "check":
      case "time": {
        // ОДНИ И ТЕ ЖЕ КОМАНДЫ, ТРИ ВОПРОСА: на сколько работ, какой
        // средний чек, сколько часов. Какой — говорит плитка, которой открыли.
        const measure = (r: (typeof teamRows)[number]) =>
          panel === "time" ? r.minutes : panel === "check" ? r.averageCheck : showMoney ? r.worked : r.records;
        const max = Math.max(0, ...teamRows.map(measure));
        const perHour = showMoney && work.perHour !== null ? `${formatEUR(work.perHour)} / ч` : null;
        return (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={listEnd}>
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
              ? empty
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
                    // Выбранная команда — акцентом, остальные тише; при «Все
                    // команды» акцентом все: сравниваются равные.
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
          </ScrollView>
        );
      }
    }
  })();

  return (
    <Screen edges={["top"]}>
      {header}
      <View style={{ flex: 1 }}>
        <ScopePeriodBar
          teams={teams}
          scopeTeamId={teamId}
          onScopeChange={setPickedTeam}
          allLabel="Все команды"
          period={period}
          onOpenPresets={() => setPresetOpen(true)}
          onOpenCustom={() => setWheelsOpen(true)}
        />

        <View className="px-4 pb-2 pt-2" style={{ gap: 6 }}>
          {showMoney ? (
            <>
              {row(
                <>
                  {tile(
                    "income",
                    "Доход",
                    moneyText(money.income),
                    moneySign(money.income) < 0 ? t.danger : t.success,
                    moneyPending || moneySign(money.income) === 0,
                  )}
                  {tile("expense", "Расход", moneyText(money.expense), t.danger, moneyPending || moneySign(money.expense) === 0)}
                </>,
              )}
              {row(
                <>
                  {tile("profit", "Прибыль", moneyText(money.profit), t.brandAccent, moneyPending || moneySign(money.profit) === 0)}
                  {tile("check", "Средний чек", formatEUR(work.averageCheck), t.ink, work.records === 0)}
                </>,
              )}
            </>
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
        visible={presetOpen}
        current={period}
        businessNow={businessNow}
        onClose={() => setPresetOpen(false)}
        onApply={setPeriod}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={period}
        onClose={() => setWheelsOpen(false)}
        onApply={setPeriod}
      />
    </Screen>
  );
}
