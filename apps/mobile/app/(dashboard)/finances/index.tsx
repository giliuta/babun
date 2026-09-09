import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Search, Settings, X } from "lucide-react-native";
import { signedAmount, type FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { money } from "@babun/shared/common/utils/money";
import { accountsTotal } from "@/features/finances/account-ui";
import { getDebtAmount } from "@babun/shared/local/appointments";
import {
  calculateInvoiceSettlement,
  invoiceInTeamScope,
} from "@babun/shared/local/finance/invoice-ledger";
import { appointmentMaterialCost } from "@babun/shared/local/finance/appointment-calc";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { useThemeColors } from "@/theme/colors";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useTeams, type Team } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useAllServices } from "@/features/services/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useRefundTotals,
  useTransactions,
} from "@/features/finances/queries";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { AccountsPanel } from "@/features/finances/AccountsPanel";
import { AccountCreateSheet } from "@/features/finances/AccountCreateSheet";
import { incomeDeals } from "@/features/finances/income-deals";
import { materialExpenseRows } from "@/features/finances/material-expenses";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { DocumentsPanel } from "@/features/finances/DocumentsPanel";
import type { DocumentFilter } from "@/features/finances/documents";
import { ProfitBreakdown } from "@/features/finances/ProfitBreakdown";
import { DebtorsList } from "@/features/finances/DebtorsList";
import { RecordRowsPanel } from "@/features/finances/RecordRowsPanel";
import {
  mergeByRecord,
  recordRows,
  type RecordRow,
} from "@/features/finances/record-rows";
import { debtRows, manualDebtRows } from "@/features/finances/debt-rows";
import { DebtSheet } from "@/features/finances/DebtSheet";
import { useDebtPaidTotals, useDebts } from "@/features/finances/debts-queries";
import {
  debtPaymentType,
  type Debt,
  type DebtDirection,
} from "@babun/shared/local/finance/debt";
import { TransactionPopup } from "@/features/finances/TransactionPopup";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import { NO_TEAM } from "@/features/finances/accounts-sections";
import { buildRefundDraft } from "@/features/finances/refund";
import {
  FinanceOverview,
  type HomeView,
} from "@/features/finances/FinanceOverview";
import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import {
  useAccountsWithBalances,
  useDeleteTransfer,
} from "@/features/finances/accounts";
import {
  defaultPeriod,
  makePeriod,
  type Period,
} from "@/features/finances/period";
import { todayYmd } from "@/features/invoices/format";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { useInvoiceNavigation } from "@/features/invoices/navigation";
import { useCalendarSettings } from "@/features/settings/local-settings";

/** Разрезы, которые вкладка умеет восстановить из адреса. Список шире, чем в
 *  `resolveReturnTo`: оттуда приходят только те, из которых открывают запись
 *  (доход, расход, долги, документы), а сюда можно прийти и диплинком. */
const VIEWS = new Set<HomeView>([
  "accounts",
  "documents",
  "income",
  "expense",
  "debt",
  "profit",
]);

/** Разрезы, в которых поиск из шапки фильтрует ПОКАЗАННОЕ. У «Счетов»,
 *  «Долгов» и «Прибыли» строк поиска нет вовсе, поэтому первая же буква
 *  возвращает ленту операций — иначе поиск молча фильтровал бы невидимое. */
const SEARCHABLE_VIEWS = new Set<HomeView>([
  "all",
  "income",
  "expense",
  "documents",
]);

/** Сколько ждать полного ухода OperationSheet, прежде чем показать второй
 *  Modal. Лист — системный Modal `animationType="slide"` на 86% высоты: его
 *  dismiss дольше 260 мс BottomSheet, и попап, смонтированный раньше, iOS
 *  молча не показывает (тот же механизм и та же пауза, что у камеры в
 *  OperationReceiptRow). После пересадки листа на BottomSheet честной снова
 *  станет SHEET_EXIT_MS. */
const OPERATION_SHEET_EXIT_MS = 450;

/** Сумма «как напечатано» и сумма «как хранится» — один канон для сравнения:
 *  без пробелов (лента ставит неразрывный U+00A0), без €, запятая → точка. */
const canonMoney = (s: string) => s.replace(/[\s€]/g, "").replace(/,/g, ".");

/** Псевдо-команда ленты скоупа для счетов, оставшихся без команды от старой
 *  схемы общего счёта. Лента FinanceOverview читает у команды только
 *  id/name/color — ими псевдо-строка и ограничена (см. одноимённый чип
 *  страницы счетов в accounts-sections.ts). */
const NO_TEAM_CHIP = {
  id: NO_TEAM,
  name: "Без команды",
  color: null as string | null,
} as Team;

function FinancesContent() {
  const t = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    clientId?: string | string[];
    /** Разрез, с которого ушли открывать запись: возврат ставит его обратно
     *  (см. resolveReturnTo). Читается один раз, при создании состояния. */
    view?: string;
  }>();
  const requestedClientId = Array.isArray(params.clientId)
    ? params.clientId[0]
    : params.clientId;
  const { openTransactionInvoice } = useInvoiceNavigation();
  // Сверхбыстрый двойной тап по плитке пушил экран дважды.
  const lastPushRef = useRef(0);
  // Поиск по операциям — центр шапки. Ищет ВНУТРИ выбранного периода:
  // лента грузится окном, и обещать больше было бы враньём.
  const [query, setQuery] = useState("");
  // Аналитика — только владельцу, как в Клиентах.
  const role = useCurrentRole().data;
  // ОДНА ДВЕРЬ НАРУЖУ на весь экран: панели уводят через неё же, поэтому
  // защита от двойного тапа одна и её нельзя забыть в новой панели.
  const pushOnce = (href: string) => {
    const now = Date.now();
    if (now - lastPushRef.current < 700) return;
    lastPushRef.current = now;
    router.push(href as Href);
  };
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const businessTimezone = calendarSettings?.timezone ?? "Europe/Nicosia";
  const businessNow = calendarSettings?.timezone
    ? getCurrentTimeInZone(businessTimezone)
    : getCurrentCyprusTime();
  const businessToday = todayYmd(businessTimezone);

  const periodTimezoneRef = useRef<string | null>(
    calendarSettingsQuery.isSuccess ? businessTimezone : null,
  );
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(businessNow));
  // If settings were not cached at mount, the initial fallback may belong to
  // another month around midnight. Rebase preset ranges once the tenant's
  // timezone arrives; a hand-picked custom range is never overwritten.
  useEffect(() => {
    if (!calendarSettingsQuery.isSuccess) return;
    if (periodTimezoneRef.current === businessTimezone) return;
    setPeriod((current) =>
      current.preset === "custom"
        ? current
        : makePeriod(
            current.preset,
            getCurrentTimeInZone(businessTimezone),
          ),
    );
    periodTimezoneRef.current = businessTimezone;
  }, [businessTimezone, calendarSettingsQuery.isSuccess]);
  // Пресет живёт по календарю компании: «Сегодня», пережившее полночь на
  // смонтированной вкладке, — уже «Вчера», и новая операция падала бы мимо
  // окна ленты. Смена бизнес-дня пересобирает диапазон той же механикой, что
  // и приезд таймзоны выше; ручной «Свой период» не трогаем.
  const periodDayRef = useRef(businessToday);
  useEffect(() => {
    if (periodDayRef.current === businessToday) return;
    periodDayRef.current = businessToday;
    const now = calendarSettings?.timezone
      ? getCurrentTimeInZone(businessTimezone)
      : getCurrentCyprusTime();
    setPeriod((current) =>
      current.preset === "custom" ? current : makePeriod(current.preset, now),
    );
  }, [businessToday, businessTimezone, calendarSettings?.timezone]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  // Разрез переживает поездку в запись: вкладка пересоздаётся при возврате, и
  // без этого «Доход» сбрасывался на «Все» (2026-09-09). Ленивый инициализатор,
  // а не эффект: разрез должен стоять уже в первом кадре, иначе человек видит
  // вспышку общей ленты. Незнакомое значение из адреса игнорируем.
  const [view, setView] = useState<HomeView>(() =>
    params.view && VIEWS.has(params.view as HomeView)
      ? (params.view as HomeView)
      : "all",
  );
  // Открыта панель документов: у шапки другой предмет поиска, и она обязана
  // сказать об этом словами подсказки.
  const documentsView = view === "documents";
  // Вид документа живёт ЗДЕСЬ, а не внутри панели: от него зависит главная
  // кнопка внизу экрана, а она снаружи. Инвойсы первыми — это единственный
  // документ, который выписывают руками.
  const [docFilter, setDocFilter] = useState<DocumentFilter>("invoice");
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  // Какую сторону долгов смотрим и какой долг правим. Живут ЗДЕСЬ, а не в
  // панели: от стороны зависит подпись главной кнопки внизу экрана, а она
  // снаружи панели (тот же довод, что у `docFilter`).
  const [debtSide, setDebtSide] = useState<DebtDirection>("incoming");
  const [debtOpen, setDebtOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  // Платёж по долгу открывает ТУ ЖЕ форму операции, что и всё остальное:
  // движение денег в продукте одно, и второй его формы быть не должно.
  const [debtPayment, setDebtPayment] = useState<{
    debtId: string;
    counterparty: string;
    amount: number;
    clientId: string | null;
    direction: DebtDirection;
  } | null>(null);

  const categoriesQuery = useFinanceCategories();
  const teamsQuery = useTeams();
  // Активные — для чипов скоупа; ВСЕ (вкл. удалённые) — для подписей
  // истории: лента/попап/CSV не должны терять имя расформированной команды.
  const allTeamsQuery = useTeams({ includeInactive: true });
  // Финансы считают СЛУЧИВШЕЕСЯ: расход материалов прошлой записи не
  // имеет права обнулиться от того, что услугу убрали из прайса.
  const servicesQuery = useAllServices();
  const appointmentsQuery = useAppointments();
  const clientsQuery = useClients();
  const invoicesQuery = useInvoices();
  const invoicePaymentsQuery = useInvoicePayments();
  const accountsQuery = useAccountsWithBalances();
  const debtsQuery = useDebts(period.from, period.to, { teamId: scope });
  const debtPaidQuery = useDebtPaidTotals();
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const allTeams = useMemo(
    () => allTeamsQuery.data ?? [],
    [allTeamsQuery.data],
  );
  const services = useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data],
  );
  const appts = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const clients = useMemo(
    () => clientsQuery.data ?? [],
    [clientsQuery.data],
  );
  const invoices = useMemo(
    () => invoicesQuery.data ?? [],
    [invoicesQuery.data],
  );
  const invoicePayments = useMemo(
    () => invoicePaymentsQuery.data ?? {},
    [invoicePaymentsQuery.data],
  );
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  // Счета без команды — сироты старой схемы общего счёта (на проде такой
  // есть: Revolut Business, ждущий переноса). Ни с одним чипом команды они
  // не совпадают, а чипа «Все» на экране нет — без своего чипа их деньги
  // были бы невидимы на вкладке ЦЕЛИКОМ. Тот же закон, что у сиротского
  // чипа страницы счетов: «ДЕНЬГИ БЕЗ ХОЗЯИНА ВСЁ РАВНО ВИДНЫ».
  const orphanAccounts = useMemo(
    () => accounts.filter((account) => !account.brigade_id),
    [accounts],
  );
  const hasOrphanAccounts = orphanAccounts.length > 0;
  const scopeChipTeams = useMemo(
    () => (hasOrphanAccounts ? [...teams, NO_TEAM_CHIP] : teams),
    [hasOrphanAccounts, teams],
  );
  // ДЕНЬГИ ВСЕГДА ЧЬИ-ТО. Владелец 2026-08-10: «компания в целом не нужна,
  // только разбивка по командам — итог по компании смотрят в сводках».
  // Поэтому скоуп никогда не бывает пустым: открываем ту команду, с которой
  // человек работает, а если её удалили — первую живую. Чип «Без команды»
  // легален, пока есть бесхозные счета; роздали — уходим на первую команду.
  // `accountsQuery.data !== undefined` — счета доехали (у хука нет isSuccess:
  // data undefined, пока не пришли обе половины — строки и остатки).
  const accountsLoaded = accountsQuery.data !== undefined;
  useEffect(() => {
    if (!teamsQuery.isSuccess) return;
    if (scope === NO_TEAM) {
      // Сироты розданы — чипа больше нет; у тенанта без команд скоуп
      // возвращается в null, иначе экран ждал бы отключённый запрос вечно.
      if (accountsLoaded && !hasOrphanAccounts) {
        setScope(teams.length > 0 ? teams[0].id : null);
      }
      return;
    }
    if (teams.length === 0) return;
    if (!scope || teams.every((team) => team.id !== scope)) {
      setScope(teams[0].id);
    }
  }, [accountsLoaded, hasOrphanAccounts, scope, teams, teamsQuery.isSuccess]);
  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const insertTx = useInsertTransaction();

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === requestedClientId) ?? null,
    [clients, requestedClientId],
  );
  const scopedAppointments = useMemo(
    () =>
      requestedClientId
        ? appts.filter((appointment) => appointment.client_id === requestedClientId)
        : appts,
    [appts, requestedClientId],
  );
  const scopedInvoices = useMemo(
    () =>
      requestedClientId
        ? invoices.filter((invoice) => invoice.client_id === requestedClientId)
        : invoices,
    [invoices, requestedClientId],
  );

  const transactionsQuery = useTransactions(
    period.from,
    period.to,
    scope === NO_TEAM
      ? {
          // Журнал бесхозных счетов режется по СЧЕТАМ, а не по team_id:
          // их проводки могут нести team_id живых команд (сдача выручки
          // старой схемы), и командный срез потерял бы эти деньги.
          accountIds: orphanAccounts.map((account) => account.id),
          enabled: orphanAccounts.length > 0,
        }
      : { brigadeIds: scope ? [scope] : undefined },
  );
  const txs = useMemo(
    () => transactionsQuery.data ?? [],
    [transactionsQuery.data],
  );

  const scopedTransactions = useMemo(
    () =>
      requestedClientId
        ? txs.filter((transaction) => transaction.client_id === requestedClientId)
        : txs,
    [requestedClientId, txs],
  );

  // Счёт = одна команда (2026-08-15): командный скоуп видит РОВНО счета
  // своей команды, «общих счетов» больше нет; чип «Без команды» показывает
  // сирот старой схемы. Скрытые балансы ВХОДЯТ в Σ (решение владельца:
  // маркер-глазик у плитки снят; скрытие остатка живёт в списках и на
  // странице счёта).
  const scopedAccounts = useMemo(() => {
    if (scope === NO_TEAM) return orphanAccounts;
    return scope ? accounts.filter((a) => accountServesTeam(a, scope)) : accounts;
  }, [accounts, orphanAccounts, scope]);
  // Одна цифра «сколько у нас денег» на весь продукт: и плитка «Счета», и
  // страница счетов считают ПОЛНУЮ сумму. Скрытых балансов в продукте нет.
  // Разбивки по видам счетов здесь НЕТ (владелец 2026-08-11): плитка отвечает
  // «сколько у команды», а не «сколько из этого наличными» — второй вопрос
  // задают на самой странице счетов, глядя на конкретный счёт.
  const accountsSummary = useMemo(
    () => ({ total: accountsTotal(scopedAccounts) }),
    [scopedAccounts],
  );

  const materialSummary = useMemo(() => {
    let amount = 0;
    let appointmentCount = 0;
    for (const appointment of scopedAppointments) {
      if (appointment.status !== "completed" && appointment.status !== "in_progress") continue;
      if (appointment.date < period.from || appointment.date > period.to) continue;
      if (scope && appointment.team_id !== scope) continue;
      const cost = appointmentMaterialCost(appointment, services);
      if (cost <= 0) continue;
      amount += cost;
      appointmentCount += 1;
    }
    return { amount, appointmentCount };
  }, [period.from, period.to, scope, scopedAppointments, services]);

  // ОДНИ И ТЕ ЖЕ ДЕНЬГИ СЧИТАЮТСЯ ОДИН РАЗ.
  //
  // «Долги» — работа сделана, деньги не получены и ничем не оформлены. Как
  // только на эту работу выставлен инвойс, те же деньги показывает плитка
  // «Документы» («ждут оплату»). Без этого исключения одна сотня евро сидела
  // в обеих цифрах сразу, и прибыль с долгами врали вместе. Аннулированный
  // инвойс не считается — он ничего не ждёт.
  //
  // ЖИВЁТ СНАРУЖИ `totals`, потому что этим набором обязаны пользоваться ОБА:
  // и цифра на плитке, и список под ней. Когда правило знала одна плитка,
  // она честно показывала «Долги €0», а список под ней печатал должника на
  // €250 — две витрины спорили об одних деньгах.
  const invoicedAppointments = useMemo(
    () =>
      new Set(
        invoices
          .filter(
            (inv) =>
              inv.appointment_id &&
              inv.status !== "void" &&
              inv.status !== "cancelled",
          )
          .map((inv) => inv.appointment_id as string),
      ),
    [invoices],
  );

  // Пустышки через useMemo, а не `?? []` в выражении: новый литерал на каждый
  // рендер ломает мемоизацию списка долгов, ради которой он и написан.
  const debts = useMemo(() => debtsQuery.data ?? [], [debtsQuery.data]);
  const debtPaid = useMemo(
    () => debtPaidQuery.data ?? new Map<string, number>(),
    [debtPaidQuery.data],
  );

  // ПЛИТКА И СПИСОК ПОД НЕЙ СЧИТАЮТ ОДНОЙ ФУНКЦИЕЙ. «Долги» — это всё, что
  // должны МНЕ: долги записей плюс ручные входящие. «Я должен» в плитку не
  // подмешивается: одни деньги придут, другие уйдут, и общая сумма не значила
  // бы ничего (владелец 2026-09-10 — две стороны, переключатель между ними).
  const manualIncomingDebt = useMemo(
    () =>
      manualDebtRows(
        debts,
        debtPaid,
        { clients, categories },
        { today: businessToday, direction: "incoming" },
      ).reduce((sum, r) => sum + r.amount, 0),
    [debts, debtPaid, clients, categories, businessToday],
  );

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of scopedTransactions) {
      if (tx.type === "income" || tx.type === "refund")
        income += signedAmount(tx);
      else if (tx.type === "expense") expense += tx.amount;
    }
    // Debt via the shared getDebtAmount (prepaid + payments[]) — the web
    // payment_status/paid_amount fields are never mapped by the mobile
    // repository, so «total − paid_amount» would flag every completed
    // visit as fully unpaid (same helper as close-day / dashboard).
    let debt = 0;
    for (const a of scopedAppointments) {
      // ОДНА КОРЗИНА. Завершённый визит без оплаты и прошедшая запись, по
      // которой бригадир не отчитался, — для владельца это одни и те же
      // неполученные деньги: «всё равно нужно принимать решение по клиенту»
      // (2026-08-09). Отдельная строка «Не закрыто» делила одно надвое.
      const past = a.date < businessToday && a.status !== "cancelled";
      if (a.status !== "completed" && !past) continue;
      if (a.status === "cancelled") continue;
      if (a.date < period.from || a.date > period.to) continue;
      if (scope && a.team_id !== scope) continue;
      if (invoicedAppointments.has(a.id)) continue;
      debt += getDebtAmount(a);
    }
    const expenseWithMaterials = expense + materialSummary.amount;
    // НДС здесь БОЛЬШЕ НЕ СЧИТАЕТСЯ (владелец 2026-08-15: плашку убрали, место
    // для неё выберем отдельно). Расчёт цел и покрыт тестами — `summarizeVat`
    // в `@babun/shared/local/finance/vat`; звать его будет новая поверхность.
    return {
      income,
      expense: expenseWithMaterials,
      profit: income - expenseWithMaterials,
      debt: debt + manualIncomingDebt,
    };
  }, [
    manualIncomingDebt,
    scopedTransactions,
    scopedAppointments,
    invoicedAppointments,
    businessToday,
    period.from,
    period.to,
    scope,
    materialSummary.amount,
  ]);

  // Σ refunds already issued against each income — caps further refunds.
  // NOT computed from the period-windowed txs: a refund is dated TODAY and
  // can land outside the viewed period (e.g. refunding a June income while
  // browsing «Прошлый месяц» on July 2) — the windowed sum would reset to 0
  // and let repeat refunds silently overdraw the ledger.
  const refundTotalsQuery = useRefundTotals();
  const refundTotals = refundTotalsQuery.data;

  // Every number on this screen combines several independent sources. Do not
  // render plausible-looking zeroes when one of them is still loading or has
  // failed: a user can otherwise make a financial decision from an
  // incomplete ledger without any visible warning.
  // isPending, не isLoading: офлайн-paused запрос (isFetching=false) иначе
  // проваливался под гейт и рисовал нулевой P&L как настоящие данные.
  // transactions — вне полного гейта: смена периода/скоупа не должна прятать
  // весь экран (хук держит прошлые данные до прихода новых); первый заход
  // ловится общим transactionsQuery.isPending без данных.
  const loading =
    (transactionsQuery.isPending && transactionsQuery.data === undefined) ||
    categoriesQuery.isPending ||
    teamsQuery.isPending ||
    servicesQuery.isPending ||
    appointmentsQuery.isPending ||
    clientsQuery.isPending ||
    invoicesQuery.isPending ||
    invoicePaymentsQuery.isPending ||
    accountsQuery.isPending ||
    refundTotalsQuery.isPending ||
    calendarSettingsQuery.isPending;
  // Смена периода или команды: прошлый срез ещё на экране, подпись уже новая.
  // Такие цифры гасятся (§8) — подменять деньги молча нельзя, по ним
  // принимают решения.
  const stale = transactionsQuery.isPlaceholderData;
  const loadError =
    (transactionsQuery.data === undefined ? transactionsQuery.error : null) ||
    (categoriesQuery.data === undefined ? categoriesQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (servicesQuery.data === undefined ? servicesQuery.error : null) ||
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (invoicesQuery.data === undefined ? invoicesQuery.error : null) ||
    (invoicePaymentsQuery.data === undefined ? invoicePaymentsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (refundTotalsQuery.data === undefined ? refundTotalsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined ? calendarSettingsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      transactionsQuery.refetch(),
      categoriesQuery.refetch(),
      teamsQuery.refetch(),
      servicesQuery.refetch(),
      appointmentsQuery.refetch(),
      clientsQuery.refetch(),
      invoicesQuery.refetch(),
      invoicePaymentsQuery.refetch(),
      accountsQuery.refetch(),
      refundTotalsQuery.refetch(),
      calendarSettingsQuery.refetch(),
    ]);

  // Возврат на таб — повод довезти чужие правки: реалтайм-мост финансовые
  // таблицы не покрывает, а экран таба живёт смонтированным весь сеанс —
  // без этого владелец, вернувшийся из календаря через час, читал утренние
  // остатки. invalidate (тот же набор, что у invalidateLedger), а не полный
  // refetch: обновляются только активные подписки, keepPreviousData держит
  // цифры без миганий. Первый фокус пропускаем — маунт и так всё грузит.
  //
  // ОДИН НАБОР КЛЮЧЕЙ НА ОБЕ ДВЕРИ ОБНОВЛЕНИЯ: возврат по фокусу и жест
  // pull-to-refresh (U86) обязаны довозить одно и то же — две копии списка
  // разъехались бы на первой правке.
  const qc = useQueryClient();
  const invalidateLedger = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["accounts"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
      ]),
    [qc],
  );
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void invalidateLedger();
    }, [invalidateLedger]),
  );
  // Жест «потянуть вниз» — один RefreshControl на все панели экрана: лента,
  // счета, документы и долги передают его своему скроллу. Крутится, пока
  // активные запросы не доедут (invalidateQueries возвращает этот промис).
  const pull = usePullRefresh(invalidateLedger);
  const refreshControl = (
    <RefreshControl
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      tintColor={t.accent}
    />
  );

  // Плитка «Документы» считает ШТУКИ, а не деньги (владелец 2026-08-11):
  // сумма к оплате — это обязательство клиента, а не наш остаток, и рядом с
  // остатком на счетах она читалась как второй кошелёк. `overdue` остался
  // суммой намеренно: он не печатается, а только решает, красить ли число —
  // «среди ждущих есть просроченные».
  // Σ ПРОСРОЧЕННОГО БОЛЬШЕ НЕ СЧИТАЕТСЯ (владелец 2026-08-15: «неоплаченный
  // документ — ничего страшного, не надо выставлять его якобы красным»). Она
  // не печаталась нигде и решала ровно один вопрос — красить ли плитку; красной
  // плитки нет, и вместе с ней ушёл счёт. Само состояние документа названо
  // словом в его строке.
  const invoiceSummary = useMemo(() => {
    let openCount = 0;
    for (const invoice of scopedInvoices) {
      // Отменённый (credit-noted) инвойс ничего не ждёт — как и void. Без
      // этого он двоился с «Долгами»: работа возвращается туда (см.
      // invoicedAppointments), а плитка продолжала считать его «ждущим».
      if (invoice.status === "void" || invoice.status === "cancelled") continue;
      // Срез команды — тем же правилом, что у списка под плиткой
      // (collectDocuments): бумага БЕЗ хозяина видна в любом срезе. Строгий
      // `brigade_id !== scope` прятал бесхозный инвойс из этой цифры, а его
      // работа уже была вычеркнута из «Долгов» как выставленная, — деньги
      // пропадали из обеих плиток и оставались только в списке.
      if (!invoiceInTeamScope(invoice, scope)) continue;
      const settlement = calculateInvoiceSettlement(
        invoice,
        invoicePayments[invoice.id] ?? [],
      );
      if (settlement.remaining <= 0) continue;
      openCount += 1;
    }
    return { openCount };
  }, [invoicePayments, scope, scopedInvoices]);

  // Листу перевода нужны сами команды, а не их имена: он подписывает счета
  // командами, и расформированная команда обязана остаться названной.
  const teamByIdAll = useMemo(
    () => new Map(allTeams.map((tm) => [tm.id, tm])),
    [allTeams],
  );

  // Материалы записей — строками в «Расходе» (владелец 2026-09-07): плитка
  // считала их всегда, теперь и список их называет поимённо.
  const materialRows = useMemo(
    () =>
      materialExpenseRows(scopedAppointments, services, {
        from: period.from,
        to: period.to,
        teamId: scope,
      }),
    [period.from, period.to, scope, scopedAppointments, services],
  );

  // ГЛАВНАЯ ЛЕНТА СЧИТАЕТ ЗАПИСЯМИ, А НЕ ПРОВОДКАМИ (владелец 2026-09-09:
  // «я хочу видеть не каждую операцию, а полноценно… но не несколько операций
  // по одной записи — это же глупо, оно забьёт всё»).
  //
  // Один визит 6 сентября держал 19 строк: оплату вносили и снимали восемь
  // раз, пока подбирали сумму. Теперь запись даёт САМОЕ БОЛЬШЕЕ ДВЕ строки —
  // свой доход целиком и свой расход целиком. Схлопывать их между собой
  // нельзя (владелец 2026-09-08: «доход 135 стоит целиком, расход 10 стоит
  // целиком, а в прибыли уже 135 − 10»), поэтому строки разные и разного
  // цвета, а ключ несёт направление — иначе две строки одного визита
  // подрались бы за один ключ списка.
  //
  // Поимённая история платежей никуда не делась: она переезжает в саму
  // запись, кнопкой в блоке оплаты.
  const recordRefs = useMemo(
    () => ({
      appointments: scopedAppointments,
      clients,
      services,
      categories,
      accounts,
    }),
    [scopedAppointments, clients, services, categories, accounts],
  );

  const blockRows = useMemo(() => {
    if (view !== "all" && view !== "income" && view !== "expense") return [];
    const tag = (rows: ReturnType<typeof recordRows>, tone: "income" | "expense") =>
      rows.map((row) => ({ ...row, tone, key: `${tone}:${row.key}` }));

    const income =
      view === "expense"
        ? []
        : tag(recordRows(incomeDeals(scopedTransactions), recordRefs), "income");
    const expense =
      view === "income"
        ? []
        : tag(
            recordRows(
              [
                ...scopedTransactions.filter((tx) => tx.type === "expense"),
                ...materialRows,
              ],
              recordRefs,
            ),
            "expense",
          );
    // Долг — деньги, которые ПРИДУТ. На своей плитке он был виден, а в общей
    // ленте его не было вовсе: «висит долг по кому-то, почему в общем нет»
    // (владелец 2026-09-09). Один визит может дать и доход, и долг — это не
    // задвоение, а два разных состояния одних работ.
    const debts =
      view === "all"
        ? debtRows(scopedAppointments, clients, services, {
            from: period.from,
            to: period.to,
            today: businessToday,
            teamId: scope === NO_TEAM ? null : scope,
            invoicedAppointmentIds: invoicedAppointments,
          }).map((row) => ({ ...row, key: `debt:${row.key}` }))
        : [];
    // Перевод — не доход и не расход: в срезах его нет, а в общей ленте он
    // обязан быть, иначе деньги между счетами исчезают из виду.
    const transfers =
      view === "all"
        ? recordRows(
            scopedTransactions.filter((tx) => tx.type === "transfer"),
            recordRefs,
          ).map((row) => ({ ...row, key: `tr:${row.key}` }))
        : [];

    const needle = query.trim().toLowerCase();
    const moneyNeedle = canonMoney(needle);
    // Ищем по тому, что человек ВИДИТ в блоке: клиент, услуги и сумма. Раньше
    // поиск шёл по проводкам (счёт, категория, заметка) — их в блоке нет, и
    // строка поиска молча искала невидимое.
    const match = (row: RecordRow) =>
      !needle ||
      row.title.toLowerCase().includes(needle) ||
      row.services.some((name) => name.toLowerCase().includes(needle)) ||
      canonMoney(money(Math.abs(row.amount))).includes(moneyNeedle);

    const all = [...income, ...expense, ...debts, ...transfers];
    // ОДНА ЗАПИСЬ — ОДНА СТРОКА (владелец 2026-09-09). В общей ленте состояния
    // одной работы склеиваются: доход главным числом, остальное подписью.
    // В разрезах склейки нет — там человек просил именно этот вид денег.
    return (view === "all" ? mergeByRecord(all) : all)
      .filter(match)
      .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const at = a.time ?? "";
      const bt = b.time ?? "";
      if (at !== bt) return at < bt ? 1 : -1;
      return a.key < b.key ? 1 : -1;
      });
  }, [
    view,
    query,
    scopedTransactions,
    materialRows,
    recordRefs,
    scopedAppointments,
    clients,
    services,
    period.from,
    period.to,
    businessToday,
    scope,
    invoicedAppointments,
  ]);

  const toggleView = (v: HomeView) =>
    setView((prev) => (prev === v ? "all" : v));

  // Real refund (web handleRefund): драфт собирает общий buildRefundDraft —
  // тот же, что на карточке счёта, — с наследованием НДС-снимка исходника.
  // Хаптик успеха НЕ здесь: возврат проводится только через TransactionPopup,
  // и сигналит он — второй вызов на экране давал двойную вибрацию.
  const handleRefund = async (tx: FinanceTransaction, amount: number) => {
    if (tx.source === "auto") {
      throw new Error("Возврат этой оплаты оформляется в связанной заявке.");
    }
    await insertTx.mutateAsync(buildRefundDraft(tx, amount, businessToday));
  };

  // ОБЩЕЙ ВЫГРУЗКИ ПО ВСЕМ ОПЕРАЦИЯМ НЕТ. Владелец 2026-08-11: «Отчёт
  // бухгалтеру» убран из продукта. Файл, который бухгалтер реально сводит с
  // банком, — это выписка по КОНКРЕТНОМУ счёту (остаток на начало, движения,
  // остаток на конец); она живёт на карточке счёта, где у неё есть эти
  // границы. Сводный CSV за период таких границ не имел и ни с чем не сходился.

  /**
   * Открыть заявку в календаре. Возвращает false, если её нет в загруженном
   * окне: уводить на экран, который скажет «заявка не найдена», хуже, чем
   * показать то, что у нас есть, — поэтому вызывающий откатывается к витрине
   * операции. Адрес тот же, каким запись открывают из карточки клиента и из
   * пуша: календарь сам встаёт на её день и её команду.
   */
  const openAppointment = (appointmentId: string): boolean => {
    const target = appts.find((a) => a.id === appointmentId);
    if (!target) return false;
    pushOnce(
      `/(dashboard)?appointmentId=${target.id}&date=${target.date}` +
        (target.team_id ? `&teamId=${target.team_id}` : "") +
        // Дорога назад: закрыв запись, человек возвращается в ленту денег, а не
        // остаётся в календаре (владелец 2026-08-15) — и в ТОТ ЖЕ разрез, из
        // которого ушёл: вкладка пересоздаётся, и «Доход» сбрасывался на «Все».
        (view === "all" ? "&from=finances" : `&from=finances:${view}`),
    );
    return true;
  };

  // Настройки — ПОЛНОЦЕННАЯ СТРАНИЦА (закон продукта). Здесь был системный
  // Alert со списком: он не умеет показывать текущие значения, и «включён ли
  // НДС» приходилось выяснять, проваливаясь внутрь.
  const openFinanceSettings = () => pushOnce("/finances/settings");

  // ШАПКА — ТА ЖЕ, ЧТО У КЛИЕНТОВ: шестерёнка · поиск · аналитика.
  //
  // Заголовка «Финансы» здесь больше нет (владелец 2026-08-09: «внизу и так
  // вкладка с этим словом»). Период в центр тоже не годится — он стоит
  // строкой ниже вместе с точными датами, и дублировать его нельзя.
  //
  // Поиск выбран потому, что он ЕДИНСТВЕННЫЙ не может задублировать цифры
  // экрана: он не показывает ни одной. И он не стареет — в отличие от любого
  // сигнала или бейджа, которые через месяц перестают замечать.
  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        minHeight: 48,
        backgroundColor: t.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
      }}
    >
      <Pressable
        onPress={openFinanceSettings}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Настройки финансов"
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: t.radius.card,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Settings color={t.sub} size={21} strokeWidth={2} />
      </Pressable>

      <View
        className="h-9 flex-1 flex-row items-center gap-1.5 px-2.5"
        style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
      >
        <Search color={t.faint} size={16} />
        <TextInput
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            // Начали печатать — возвращаем ленту, если открытая панель искать
            // не умеет: в разрезах «Счета», «Долги» и «Прибыль» строк поиска
            // на экране нет вовсе, и он фильтровал бы невидимое.
            if (next.trim() && !SEARCHABLE_VIEWS.has(view)) setView("all");
          }}
          // ПОДСКАЗКА НАЗЫВАЕТ ТО, ГДЕ ИЩУТ. Одно поле обслуживает две ленты, и
          // «Сумма, счёт, заметка» над списком документов было бы прямым
          // враньём: по счёту и заметке документ не ищется.
          //
          // Слова для операций — ФИНАНСОВЫЕ: так человек её и ищет — по сумме,
          // по кассе, по своей же заметке. «Клиент» и «категория» здесь не то,
          // чем думают в этом разделе (владелец 2026-08-09), хотя искать по ним
          // поле по-прежнему умеет.
          placeholder={
            documentsView ? "Номер, клиент, сумма" : "Сумма, счёт, заметка"
          }
          accessibilityLabel={
            documentsView ? "Поиск по документам" : "Поиск по операциям"
          }
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={1.3}
          className="flex-1 text-[15px]"
          style={{ color: t.ink, paddingVertical: 0 }}
        />
      </View>

      {/* Аналитика — как в Клиентах, и с тем же гейтом: бригадиру не
          показываем кнопку, которой у него нет. */}
      {role === "owner" ? (
        <Pressable
          onPress={() => router.push("/cabinet/insights")}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Аналитика по финансам"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <BarChart3 color={t.sub} size={21} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );

  // Счётчик считает ПОКАЗАННОЕ. Лента считает записями, а не проводками:
  // «Операции · 19» над одним визитом читалось как девятнадцать дел
  // (2026-09-09).
  const feedTitle =
    view === "income"
      ? `Доход · ${blockRows.length}`
      : view === "expense"
        ? `Расход · ${blockRows.length}`
        : `Записи · ${blockRows.length}`;

  if (loading) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        {header}
        <EmptyState
          state="error"
          fill
          subtitle={(loadError as Error).message}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      {header}
      {/* Пока едет новый срез, цифры прошлого периода ГАСНУТ, а не выдаются за
          новые. `keepPreviousData` держит их, чтобы экран не мигал пустотой, —
          но под новой подписью периода это чужие деньги, и решение по ним
          принимать нельзя. Полоска под шапкой говорит, что работа идёт. */}
      <LoadingBar visible={stale} />

      <View style={{ flex: 1, opacity: stale ? 0.4 : 1 }}>
        <FinanceOverview
          teams={scopeChipTeams}
          scopeTeamId={scope}
          onScopeChange={setScope}
          period={period}
          onOpenPresets={() => setPresetOpen(true)}
          onOpenCustom={() => setWheelsOpen(true)}
          totals={totals}
          accounts={accountsSummary}
          invoices={invoiceSummary}
          view={view}
          onTap={toggleView}
        />

        {requestedClientId ? (
          <View
            className="mx-4 mb-2 flex-row items-center px-4 py-3"
            style={{
              backgroundColor: t.surface,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
            }}
          >
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
                Финансы клиента
              </Text>
              <Text className="mt-0.5 text-[15px] font-semibold" style={{ color: t.ink }} numberOfLines={1}>
                {selectedClient?.full_name || "Клиент"}
              </Text>
            </View>
            <Pressable
              onPress={() => router.replace("/finances")}
              accessibilityRole="button"
              accessibilityLabel="Показать финансы всех клиентов"
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
              style={{ backgroundColor: t.fill }}
            >
              <X color={t.sub} size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}

        {view === "accounts" ? (
          <AccountsPanel
            accounts={scopedAccounts}
            teams={teams}
            onOpen={pushOnce}
            refreshControl={refreshControl}
          />
        ) : view === "documents" ? (
          <DocumentsPanel
            invoices={scopedInvoices}
            payments={invoicePayments}
            appointments={scopedAppointments}
            accounts={accounts}
            clients={clients}
            clientId={requestedClientId}
            teamId={scope}
            period={period}
            today={businessToday}
            query={query}
            filter={docFilter}
            onFilterChange={setDocFilter}
            onOpen={pushOnce}
            refreshControl={refreshControl}
          />
        ) : view === "profit" ? (
          <ProfitBreakdown
            transactions={scopedTransactions}
            categories={categories}
            services={services}
            appointments={scopedAppointments}
            materialCost={materialSummary.amount}
            materialAppointmentCount={materialSummary.appointmentCount}
          />
        ) : view === "debt" ? (
          <DebtorsList
            appointments={scopedAppointments}
            clients={clients}
            services={services}
            teamId={scope}
            fromDate={period.from}
            toDate={period.to}
            todayYmd={businessToday}
            invoicedAppointmentIds={invoicedAppointments}
            debts={debts}
            paidTotals={debtPaid}
            categories={categories}
            direction={debtSide}
            onDirectionChange={setDebtSide}
            onEditDebt={(debtId) => {
              const found = debts.find((d) => d.id === debtId);
              if (!found) return;
              setEditingDebt(found);
              setDebtOpen(true);
            }}
            onOpenDocuments={() => {
              setDocFilter("invoice");
              setView("documents");
            }}
            refreshControl={refreshControl}
          />
        ) : (
          <RecordRowsPanel
            rows={blockRows}
            title={feedTitle}
            emptyTitle={
              query.trim()
                ? "В выбранном периоде ничего не найдено"
                : view === "income"
                  ? "Дохода за период нет"
                  : view === "expense"
                    ? "Расхода за период нет"
                    : "Нет операций за период"
            }
            onReset={view !== "all" ? () => setView("all") : undefined}
            refreshControl={refreshControl}
            onOpenRecord={(row) => {
              // ДЕНЬГИ ПО ЗАПИСИ ОТКРЫВАЮТ САМУ ЗАПИСЬ (владелец 2026-08-15).
              if (row.appointmentId && openAppointment(row.appointmentId)) return;
              // Одиночная операция — бензин, обед, перевод — открывается на
              // правку: другой двери к ней на экране нет. Витрина остаётся
              // тому, что править нельзя (перевод, проводка инвойса).
              const tx = row.txId
                ? scopedTransactions.find((x) => x.id === row.txId)
                : null;
              if (!tx) return;
              if (canEditTransaction(tx)) {
                setEditingTx(tx);
                setOpOpen(true);
                return;
              }
              setPopupTx(tx);
            }}
          />
        )}
      </View>

      {/* ГЛАВНОЕ ДЕЙСТВИЕ СЛЕДУЕТ ЗА ОТКРЫТОЙ ПАНЕЛЬЮ (владелец 2026-08-12).
          Кнопка стоит на одном месте — том же, что «Добавить клиента» на
          вкладке «Клиенты», — но делает то, чего человек хочет ЗДЕСЬ:
            • счета     → перевод. Счёт заводят раз в квартал, а перекладывают
                          деньги каждый день; создание живёт на странице счетов;
            • документы → новый инвойс. Это единственный документ, который
                          выписывают руками: чек продукт выдаёт сам при приёме
                          денег, договоры ещё не сделаны;
            • остальное → операция, то есть доход или расход.
          Экран берёт только верхний отступ (edges=["top"]), иначе нижняя
          безопасная зона поднимала кнопку выше клиентской, и при переходе
          между вкладками она прыгала. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        {view === "accounts" ? (
          // КНОПКА ДЕЛАЕТ ТО, ЧТО ВОЗМОЖНО (владелец 2026-09-07: «нет ни одного
          // счёта — кнопка „Добавить счёт“; после создания она сама меняется
          // на переводы»). Перевод — движение между ДВУМЯ счетами, поэтому до
          // второго счёта кнопка заводит счёт, а не стоит серой с оправданием.
          // Считаем ВСЕ счета тенанта, а не срез команды: деньги ходят между
          // командами.
          accounts.length < 2 ? (
            <GradientButton
              label="Добавить счёт"
              onPress={() => setCreateAccountOpen(true)}
            />
          ) : (
            <GradientButton
              label="Сделать перевод"
              onPress={() => setTransferOpen(true)}
            />
          )
        ) : view === "documents" && docFilter === "receipt" ? (
          // ЧЕК НЕЛЬЗЯ ВЫПИСАТЬ КНОПКОЙ. Его выдаёт сервер в тот же миг, когда
          // принимает деньги (триггер issue_receipt_for_income): чек — это
          // доказательство, что оплата получена, и бумага без денег была бы
          // подделкой. Рождается он ТОЛЬКО у дохода С КЛИЕНТОМ (триггер
          // выходит при client_id null), а форма операции клиента не знает —
          // доход записывался, чек не появлялся никогда. Клиент уже есть у
          // ЗАПИСИ, поэтому кнопка ведёт в «Долги» — список работ, ждущих
          // денег: оплату принимают в самой записи (канон владельца), и чек
          // рождается сам. Выслать уже выданный чек можно из него самого.
          <GradientButton
            label="Принять оплату"
            onPress={() => setView("debt")}
          />
        ) : view === "documents" ? (
          <GradientButton
            label="Выставить инвойс"
            onPress={() => pushOnce("/invoices/new")}
          />
        ) : view === "debt" ? (
          // ДОЛГ — СВОЯ СУЩНОСТЬ, И ЗАВОДИТСЯ ОН СВОЕЙ ШТОРКОЙ (владелец
          // 2026-09-10: «почему, когда я нажимаю „Добавить долг“, открывается
          // форма записи? Там должна открываться такая менюшка, только,
          // наверно, другие категории»).
          //
          // Раньше кнопка уводила в создание ЗАПИСИ: долг умел рождаться
          // только из визита, и «Вася должен мне €100» без визита, как и «я
          // должен Gree €900» за товар, записать было негде. Теперь у долга
          // есть строка с направлением, и форма спрашивает ровно его вопросы —
          // без счёта и способа оплаты: долг не деньги, деньги будут платежом.
          <GradientButton
            label={debtSide === "incoming" ? "Добавить долг" : "Добавить свой долг"}
            onPress={() => {
              setEditingDebt(null);
              setDebtOpen(true);
            }}
          />
        ) : (
          // КНОПКА СЛЕДУЕТ ЗА РАЗРЕЗОМ (владелец 2026-09-08: «нажимаю на доход
          // — внизу меняется кнопка на добавить доход… и вытягивается только
          // по доходу»). Направление уже выбрано плиткой; спрашивать его
          // второй раз в форме незачем.
          <GradientButton
            label={
              view === "income"
                ? "Добавить доход"
                : view === "expense"
                  ? "Добавить расход"
                  : "Добавить операцию"
            }
            onPress={() => {
              setEditingTx(null);
              setOpOpen(true);
            }}
          />
        )}
      </View>

      <TransactionPopup
        visible={!!popupTx}
        transaction={popupTx}
        accounts={accounts}
        teams={allTeams}
        categories={categories}
        // Пока Σ возвратов не загрузилась (refundTotals === undefined),
        // консервативно прячем «Создать возврат» (Infinity → остаток 0):
        // занизить кап хуже, чем задержать кнопку на долю секунды.
        alreadyRefunded={
          popupTx
            ? refundTotals
              ? refundTotals.get(popupTx.id) ?? 0
              : Number.POSITIVE_INFINITY
            : 0
        }
        onClose={() => setPopupTx(null)}
        onInvoice={(tx) => {
          setPopupTx(null);
          openTransactionInvoice(tx);
        }}
        onClientOpen={(clientId) => {
          setPopupTx(null);
          router.push(`/clients/${clientId}`);
        }}
        onDelete={async (tx) => {
          // Перевод удаляется ТОЛЬКО целиком: обе ноги атомарно по
          // transfer_group_id (web parity) — удаление одной ноги оставило бы
          // полперевода и сломало остатки обоих счетов.
          if (tx.type === "transfer") {
            if (!tx.transfer_group_id) {
              throw new Error(
                "У перевода повреждена связь между счетами. Операция не изменена.",
              );
            }
            await delTransfer.mutateAsync(tx.transfer_group_id);
            return;
          }
          await delTx.mutateAsync(tx.id);
        }}
        onRefund={handleRefund}
      />

      <OperationSheet
        visible={opOpen}
        // editingTx НЕ обнуляется здесь: шапка мигала «Операция»→«Новая
        // операция» пока лист уезжал; открывающие пути сами ставят нужное.
        onClose={() => {
          setOpOpen(false);
          setDebtPayment(null);
        }}
        // Псевдо-скоуп «Без команды» команды не несёт: лист сам спросит.
        defaultTeamId={scope === NO_TEAM ? null : scope}
        // Разрез уже сказал направление — форма открывается им же. У платежа
        // по долгу направление решает сам долг: «мне должны» гасят доходом,
        // «я должен» — расходом.
        defaultType={
          debtPayment
            ? debtPaymentType(debtPayment.direction)
            : view === "income"
              ? "income"
              : "expense"
        }
        debtPayment={debtPayment}
        businessToday={businessToday}
        transaction={editingTx}
        onInvoice={(tx) => {
          setOpOpen(false);
          openTransactionInvoice(tx);
        }}
        onClientOpen={(clientId) => {
          setOpOpen(false);
          router.push(`/clients/${clientId}`);
        }}
        onRefund={(tx) => {
          // Возврат — форма витрины: там уже посчитан остаток и кап.
          setOpOpen(false);
          setTimeout(() => setPopupTx(tx), OPERATION_SHEET_EXIT_MS);
        }}
        // Пока Σ возвратов не приехала — та же консервативность, что у
        // попапа выше: Infinity гасит «Создать возврат» (остаток 0), иначе
        // действие маячило бы и у полностью возвращённого дохода.
        refundedTotal={
          editingTx
            ? refundTotals
              ? refundTotals.get(editingTx.id) ?? 0
              : Number.POSITIVE_INFINITY
            : 0
        }
      />

      {/* Долг — своя шторка из тех же блоков, что операция: направление,
          день, кто, категория, сумма, заметка. Счёта в ней нет нарочно — долг
          не деньги, и в момент его появления со счёта ничего не уходит.
          Сторона приезжает из переключателя панели: нажав «Я должен», человек
          заводит свой долг, а не чужой. */}
      <DebtSheet
        visible={debtOpen}
        debt={editingDebt}
        paid={editingDebt ? debtPaid.get(editingDebt.id) ?? 0 : 0}
        onPay={(payment) => {
          // Одна шторка закрывается, следом открывается другая: два окна в
          // один кадр iOS не показывает («already presenting»).
          setDebtOpen(false);
          setEditingTx(null);
          setDebtPayment(payment);
          setTimeout(() => setOpOpen(true), OPERATION_SHEET_EXIT_MS);
        }}
        initialDirection={debtSide}
        teamId={scope === NO_TEAM ? null : scope}
        teamName={
          scope && scope !== NO_TEAM ? teamByIdAll.get(scope)?.name : undefined
        }
        onClose={() => setDebtOpen(false)}
      />

      {/* Перевод — тот же лист, что на странице счетов: одна форма движения
          денег на продукт. Счета отдаём ВСЕ, не срез команды: деньги ходят
          между всеми счетами тенанта, и фильтр экрана на них не распространяется
          (иначе «сдать выручку на счёт другой команды» стало бы невозможно). */}
      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={accounts}
        teamById={teamByIdAll}
      />
      {/* Первый счёт заводится прямо отсюда — тем же листом, что на странице
          счетов; команда — та, что выбрана чипом. */}
      <AccountCreateSheet
        visible={createAccountOpen}
        onClose={() => setCreateAccountOpen(false)}
        teams={teams}
        accounts={accounts}
        presetTeamId={scope === NO_TEAM ? null : scope}
      />

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

// Граница прав живёт в `finances/_layout.tsx` и накрывает ВЕСЬ каталог:
// вторая копия здесь закрывала бы только корень, оставляя `/finances/vat` и
// `/finances/settings` открытыми по диплинку.
export default function FinancesTab() {
  return <FinancesContent />;
}
