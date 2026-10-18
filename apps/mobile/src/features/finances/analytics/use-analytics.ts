import { useMemo, useState } from "react";
import { summarizeVat } from "@babun/shared/local/finance/vat";
import { useMyAccess } from "@/session/access-queries";
import { useAppointments, useFinanceServices } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { useCurrentRole } from "@/session/tenant";
import { useAccountsWithBalances } from "../accounts";
import {
  financeReadRules,
  moneyPanelOpen,
  moneySides,
  readableTransactions,
} from "../finance-read-rules";
import { makePeriod, type Period } from "@/lib/period";
import { useBusinessClock } from "../home/use-business-clock";
import { useBusinessPeriod } from "../use-business-period";
import { useFinanceCategories, useTransactions } from "../queries";
import { useClientInvoicing } from "../client-invoicing";
import { awaitingAnswer } from "../ledger-select";
import {
  accountBreakdown,
  cancelledCount,
  previousPeriod,
  serviceProfit,
  upcomingRecords,
  clientBreakdown,
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

/** Долгов аналитика не грузит: оплата долга судится командой самой строки
 *  (платёж проводится в команде долга). */
const NO_DEBT_TEAMS: ReadonlyMap<string, string | null> = new Map();

export type Panel =
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
}

/** Every query, state and derived number of the analytics screen, in the
 *  screen's original hook order. */
export function useAnalytics(start: AnalyticsStart) {
  const role = useCurrentRole().data;
  const myAccess = useMyAccess().data;
  // ДЕНЬГИ — ПО ФИНАНСОВОМУ ПРАВУ (как было у «Сводки»): записи
  // диспетчеру приходят с суммами, и выручка компании не должна утекать мимо
  // блока «Доходы» (выручка — это доход).
  // РАСХОД — ПО СВОЕМУ ПРАВУ: без «Расходов» нет ни
  // расхода, ни прибыли, ни материалов услуг (`moneySides`).
  const sides = moneySides({ role, map: myAccess });
  const showMoney = sides.income;
  const showExpense = showMoney && sides.expense;
  const clock = useBusinessClock();
  const { businessNow, businessToday: today } = clock;
  // Строки журнала — по стороне и команде строки и «Ограничениям»,
  // как режет сервер: «его глазами» журнал читается токеном владельца.
  const readRules = useMemo(
    () => financeReadRules({ role, map: myAccess, today }),
    [role, myAccess, today],
  );
  // «Сейчас» для сегодняшних записей: сделана — когда её время кончилось.
  const nowHm = `${String(businessNow.getHours()).padStart(2, "0")}:${String(
    businessNow.getMinutes(),
  ).padStart(2, "0")}`;

  // Пресет живёт по календарю компании и переживает полночь и приезд пояса
  // так же, как у «Финансов» (`use-business-period.ts`).
  const [period, setPeriod] = useBusinessPeriod(
    clock,
    (now): Period => start.period ?? makePeriod("month", now),
  );
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  /** `null` — вся компания (так аналитика и открывается: все команды,
   *  нажал команду — её);
   *  строка — выбранная команда, повторный тап по ней снимает выбор. */
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const [pickedPanel, setPanel] = useState<Panel>("services");
  // Денежная панель без права на её деньги не открывается — экран стоит на
  // услугах, как при входе.
  const panel: Panel = moneyPanelOpen(pickedPanel, { income: showMoney, expense: showExpense, profit: sides.profit })
    ? pickedPanel
    : "services";

  const teamsData = useTeams().data;
  const teams = useMemo(() => teamsData ?? [], [teamsData]);
  // Выбранная команда исчезла (удалили, ушли в другую компанию) — снова вся
  // компания, а не чужой срез.
  const teamId =
    pickedTeam !== null && teams.some((team) => team.id === pickedTeam) ? pickedTeam : null;

  const apptsQuery = useAppointments();
  // АРХИВНЫХ КАЛЕНДАРЕЙ В ЖИВЫХ ЦИФРАХ НЕТ: на «всей
  // компании» их записи и деньги попадали в итоги.
  // Справочник ещё едет — не режем, иначе на кадр всё обнулилось бы.
  const liveTeam = useMemo(
    () => (teamsData ? new Set(teamsData.map((team) => team.id)) : null),
    [teamsData],
  );
  const appointments = useMemo(
    () =>
      (apptsQuery.data ?? []).filter(
        (a) => !liveTeam || !a.team_id || liveTeam.has(a.team_id),
      ),
    [apptsQuery.data, liveTeam],
  );
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
  const accountsData = useAccountsWithBalances({ includeInactive: true, includeDeleted: true }).data;
  const accountTeam = useMemo(
    () => new Map((accountsData ?? []).map((a) => [a.id, a.brigade_id ?? null] as const)),
    [accountsData],
  );

  // ОДИН ЗАПРОС ЖУРНАЛА НА ВСЁ: период и все его годы для таблицы по месяцам
  // (период через новый год — оба года).
  const yearFrom = Number(period.from.slice(0, 4));
  const yearTo = Number(period.to.slice(0, 4));
  const yearEnd = `${yearTo}-12-31`;
  // Прошлый период — для списка «К прошлому периоду» (`previousPeriod`).
  const prev = previousPeriod(period.from, period.to, today);
  const ledgerFrom = [period.from, prev.from, `${yearFrom}-01-01`].sort()[0];
  const ledgerTo = [period.to, yearEnd < today ? yearEnd : today].sort()[1];
  const ledger = useTransactions(ledgerFrom, ledgerTo, { enabled: showMoney });
  const txs = useMemo(
    () =>
      readableTransactions(
        (ledger.data ?? []).filter(
          (tx) => !liveTeam || !tx.team_id || liveTeam.has(tx.team_id),
        ),
        readRules,
        NO_DEBT_TEAMS,
      ),
    [ledger.data, liveTeam, readRules],
  );

  const scope: Scope = useMemo(
    () => ({ from: period.from, to: period.to, today, teamId, accountTeam, nowHm }),
    [period.from, period.to, today, teamId, accountTeam, nowHm],
  );
  const records = useMemo(() => performedRecords(appointments, scope), [appointments, scope]);
  // «Не оплачено» — правилом плитки «Долги»: работа под инвойсом должна
  // остаток инвойса, а не недоплату записи после кредит-ноты.
  const invoicing = useClientInvoicing();
  const work = useMemo(() => workTotals(records, invoicing), [records, invoicing]);
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
  const serviceProfitRows = useMemo(
    () => serviceProfit(serviceRows, records, financeServices),
    [serviceRows, records, financeServices],
  );
  const prevScope: Scope = useMemo(
    () => ({ ...scope, from: prev.from, to: prev.to }),
    [scope, prev.from, prev.to],
  );
  const workPrev = useMemo(
    () => workTotals(performedRecords(appointments, prevScope), invoicing),
    [appointments, prevScope, invoicing],
  );
  const moneyPrev = useMemo(
    () => moneyTotals(txs, appointments, financeServices, prevScope),
    [txs, appointments, financeServices, prevScope],
  );
  // Текущий период до сегодня отдельно не режем: будущих денег в нём нет, а
  // будущие записи не «сделаны» (`isPerformed`) — сравниваются равные куски.
  const [refreshing, setRefreshing] = useState(false);
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
  // ПРОГНОЗ: записи, которые ещё впереди в периоде, и их сумма работ.
  const upcoming = useMemo(() => upcomingRecords(appointments, scope), [appointments, scope]);
  const upcomingWork = useMemo(() => workTotals(upcoming, invoicing), [upcoming, invoicing]);
  // VAT ЗА ПЕРИОД — тем же расчётом, что страница VAT (`summarizeVat`), по
  // операциям среза: команда и период уже отобраны.
  const vat = useMemo(() => summarizeVat(periodTxs), [periodTxs]);
  const vatSeen = useMemo(
    () => periodTxs.some((tx) => tx.vat_amount != null && tx.vat_mode !== "none"),
    [periodTxs],
  );
  const cancelled = useMemo(() => cancelledCount(appointments, scope), [appointments, scope]);
  // ДЕНЬГИ ЕЩЁ ЕДУТ — плитка говорит «—», а не «€0»: ноль выглядел бы фактом
  // хотя журнал просто не доехал. Смена периода меняет
  // ключ журнала, и заглушка отдаёт строки ПРОШЛОГО диапазона: без проверки
  // заглушки «Прошлый год» до ответа показывал нули и обрывки текущего месяца
  //.
  const moneyPending = showMoney && (ledger.data === undefined || awaitingAnswer(ledger));
  const scopedAppointments = useMemo(
    () => appointments.filter((a) => teamId === null || a.team_id === teamId),
    [appointments, teamId],
  );

  // ПОТЯНУТЬ ВНИЗ — ПЕРЕЧИТАТЬ ВСЁ СРАЗУ: деньги, записи, счета. Цифры
  // пересчитываются в тот же кадр, как приехал ответ.
  const refresh = () => {
    setRefreshing(true);
    void Promise.allSettled([
      ledger.refetch(),
      apptsQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  };

  const toggle = (next: Panel) => setPanel((cur) => (cur === next ? "services" : next));
  const quantity = serviceRows.reduce((s, r) => s + r.quantity, 0);

  return {
    sides,
    showMoney,
    showExpense,
    businessNow,
    today,
    period,
    setPeriod,
    presetOpen,
    setPresetOpen,
    wheelsOpen,
    setWheelsOpen,
    setPickedTeam,
    panel,
    setPanel,
    teams,
    teamId,
    apptsQuery,
    clientName,
    services,
    people,
    categories,
    yearFrom,
    yearTo,
    prev,
    work,
    money,
    periodTxs,
    materials,
    serviceRows,
    serviceProfitRows,
    workPrev,
    moneyPrev,
    refreshing,
    clientRows,
    teamRows,
    months,
    incomeByAccount,
    expenseByAccount,
    weekdays,
    upcoming,
    upcomingWork,
    vat,
    vatSeen,
    cancelled,
    moneyPending,
    scopedAppointments,
    refresh,
    toggle,
    quantity,
  };
}

export type Analytics = ReturnType<typeof useAnalytics>;
