import { useDisabledFeatures } from "@/features/settings/company-features";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Search, Settings, X } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { containsPattern } from "@/lib/like-pattern";
import { useTenantId } from "@/lib/tenant";
import { useSession } from "@/providers/SessionProvider";
import { GUTTER } from "@/components/ui/tokens";
import { signedAmount, type FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { accountsTotal } from "@/features/finances/account-ui";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { invoicedAppointmentIds } from "@babun/shared/local/finance/invoice-ledger";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { useThemeColors } from "@/theme/colors";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useMasters, useTeams, type Team } from "@/features/reference/queries";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole, usePlanAllows } from "@/features/settings/tenant";
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
import { FinancesFooter } from "@/features/finances/FinancesFooter";
import { financePageAccess } from "@/features/finances/finance-page-access";
import {
  financeReadRules,
  readableDebts,
  readableDocuments,
  readableTransactions,
  type DocumentsReadable,
} from "@/features/finances/finance-read-rules";
import { incomeDeals } from "@/features/finances/income-deals";
import { materialExpenseRows } from "@/features/finances/material-expenses";
import { useFinanceRoute } from "@/features/finances/use-finance-route";
import { fallbackScopeUpdate } from "@/features/finances/finance-route";
import { DocumentsPanel } from "@/features/finances/DocumentsPanel";
import { usePeriodDocuments } from "@/features/finances/use-period-documents";
import type { DocumentFilter } from "@/features/finances/documents";
import { ProfitBreakdown } from "@/features/finances/ProfitBreakdown";
import { materialsByService } from "@/features/finances/breakdown";
import { periodMaterials, periodMoney } from "@/features/finances/profit-compare";
import { previousPeriod } from "@/features/finances/analytics/analytics-math";
import { DebtorsList } from "@/features/finances/DebtorsList";
import { panelCount } from "@/features/finances/PanelHeader";
import { RecordRowsPanel } from "@/features/finances/RecordRowsPanel";
import {
  mergeByRecord,
  recordRows,
  rowMatchesQuery,
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
import { NO_TEAM, sortAccountRows } from "@/features/finances/accounts-sections";
import {
  hasTeamlessMoney,
  inTeamScope,
  teamlessLedgerRows,
  withTeamlessRows,
} from "@/features/finances/team-scope";
import { buildRefundDraft } from "@/features/finances/refund";
import { loadErrorWords, writeErrorWords } from "@/lib/connection-words";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { deleteOperationAlert, deleteTransferAlert } from "@/features/finances/account-alerts";
import { deletableByHand, refundBlocksDelete } from "@/features/finances/operation-delete";
import {
  FinanceOverview,
  ScopePeriodBar,
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
import { financesFrom } from "@/features/appointments/return-to";
import { formatHM } from "@/features/appointments/helpers";
import { isPastRecord } from "@/features/calendar/day-ledger";

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

/** Псевдо-команда ленты скоупа для счетов, оставшихся без команды от старой
 *  схемы общего счёта. Лента FinanceOverview читает у команды только
 *  id/name/color — ими псевдо-строка и ограничена (`NO_TEAM` в
 *  accounts-sections.ts). */
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
     *  (см. resolveReturnTo). Применяется и на смонтированной вкладке. */
    view?: string;
    /** Счёт, чья лента была открыта под «Счетами», — тем же возвратом. */
    account?: string;
    /** Команда «Счетов» — ссылки «заведите счёт этой команде». */
    team?: string;
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
  const tenantId = useTenantId();
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
  const businessNowHm = formatHM(businessNow);

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
  // ДОКУМЕНТОВ НА БЕСПЛАТНОМ ТАРИФЕ НЕТ ВОВСЕ — ни плитки, ни разреза, ни
  // кнопки «Выставить инвойс» (канон: без права блок не показывается либо
  // только читается; «видно, но при нажатии ошибка» в продукте не бывает).
  // Настоящий запрет стоит триггером `enforce_plan_limits` в базе, здесь —
  // вид на него.
  const canUseDocuments = usePlanAllows("documents");
  // Вид документа живёт ЗДЕСЬ, а не внутри панели: от него зависит главная
  // кнопка внизу экрана, а она снаружи. Инвойсы первыми — это единственный
  // документ, который выписывают руками.
  const [docFilter, setDocFilter] = useState<DocumentFilter>("invoice");
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);
  // Какую сторону долгов смотрим и какой долг правим. Живут ЗДЕСЬ, а не в
  // панели: от стороны зависит подпись главной кнопки внизу экрана, а она
  // снаружи панели (тот же довод, что у `docFilter`).
  const [debtSide, setDebtSide] = useState<DebtDirection>("incoming");
  const [debtOpen, setDebtOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  // Платёж по долгу открывает ТУ ЖЕ форму операции, что и всё остальное:
  // движение денег в продукте одно, и второй его формы быть не должно.
  const reopenDebtSheet = useCallback(() => setDebtOpen(true), []);
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
  // Лист перевода — со СКРЫТЫМИ счетами (владелец 03.10: «в конце месяца
  // переводить на накопительный»); плитки и панель «Счета» их не знают.
  const transferAccountsQuery = useAccountsWithBalances({ includeHidden: true });
  // С закрытыми — только ради имён в строках ленты: операция периода могла
  // пройти через счёт, который с тех пор закрыли.
  // ПОДПИСИ ИСТОРИИ — СО СКРЫТЫМИ И УДАЛЁННЫМИ: имя и команда счёта у
  // прошлой операции не пропадают, когда счёт ушёл в «Удалённые счета».
  const allAccountsQuery = useAccountsWithBalances({ includeInactive: true, includeDeleted: true });
  // Разрез, команда и выбранный счёт — из адреса и из тапов.
  const {
    view: routeView,
    setView,
    scope,
    setScope,
    accountId,
    setAccountId,
    changeScope,
  } = useFinanceRoute(params, accountsQuery.data);
  // УРОВЕНЬ ЧЕЛОВЕКА В ВЫБРАННОМ КАЛЕНДАРЕ — ОДНИМ ПРАВИЛОМ НА ВЕСЬ ЭКРАН
  // (`finance-page-access.ts`). Экран только читает ответы: что живое, что
  // серое, что можно править. Владелец карты прав не ждёт.
  const myAccessQuery = useMyAccess();
  const disabledFeatures = useDisabledFeatures();
  const userId = useSession().session?.user.id ?? null;
  const access = financePageAccess({
    role,
    map: myAccessQuery.data,
    scope,
    disabledFeatures,
    userId,
  });
  // ЧТО ВИДНО ПО СТРОКЕ — её сторона в её команде (`finance-read-rules.ts`).
  // Сотруднику строки режет сервер, а «его глазами» читают токеном владельца:
  // без этого лента показала бы расход при «Расходы: Не видит». У владельца
  // фильтры отдают вход как есть.
  const readRules = useMemo(
    () => financeReadRules({ role, map: myAccessQuery.data }),
    [role, myAccessQuery.data],
  );
  // Гасим РАЗРЕЗ документов, а не только плитку: в «Документы» приходят и
  // адресом `?view=documents`, и возвратом из записи. Закрытая уровнем панель
  // уходит туда же — на общий вид, а не показывает пустоту.
  const view: HomeView = access.view(
    !canUseDocuments && routeView === "documents" ? "all" : routeView,
  );
  // Открыта панель документов: у шапки другой предмет поиска, и она обязана
  // сказать об этом словами подсказки.
  const documentsView = view === "documents";
  // «Без команды» — не команда: долги под этим чипом отбираются на экране
  // (`team_id` пуст), а у хука берётся вся компания тем же ключом.
  // ДОЛГИ — ЗА ВЫБРАННЫЙ ПЕРИОД (владелец 03.10, вечером, после «долги это
  // долги»: «лучше выбирать период — я могу запутаться в деньгах; выбираю
  // текущий месяц — и долги только по текущему месяцу»). Плитка, панель
  // «Долги» и лента считают одно окно. Оплаты долга при этом — без окна
  // (`useDebtPayments`): долг из этого месяца, закрытый в следующем, закрыт.
  const debtsQuery = useDebts(period.from, period.to, {
    teamId: scope === NO_TEAM ? null : scope,
  });
  // Вся компания без отбора — тот же ключ, лишнего запроса нет: по ней видно,
  // есть ли долги без команды, которым нужен чип «Без команды».
  const companyDebtsQuery = useDebts(period.from, period.to);
  // Команда каждого долга: оплата долга видна и по «Долгам» его команды.
  const debtTeams = useMemo(
    () =>
      new Map(
        (companyDebtsQuery.data ?? []).map((debt) => [debt.id, debt.team_id ?? null] as const),
      ),
    [companyDebtsQuery.data],
  );
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
  const allAccounts = useMemo(
    () => allAccountsQuery.data ?? accounts,
    [allAccountsQuery.data, accounts],
  );
  // Счета без команды — сироты старой схемы общего счёта. Ни с одним чипом
  // команды они не совпадают, а чипа «Все» на экране нет — без своего чипа их
  // деньги были бы невидимы на вкладке ЦЕЛИКОМ: «ДЕНЬГИ БЕЗ ХОЗЯИНА ВСЁ РАВНО
  // ВИДНЫ».
  const orphanAccounts = useMemo(
    () => accounts.filter((account) => !account.brigade_id),
    [accounts],
  );
  const hasOrphanAccounts = orphanAccounts.length > 0;
  // Команда каждого счёта, включая закрытые: строка журнала без команды встаёт
  // под команду своего счёта (`team-scope.ts`).
  const accountTeam = useMemo(
    () =>
      new Map(
        allAccounts.map((account) => [account.id, account.brigade_id ?? null] as const),
      ),
    [allAccounts],
  );
  // Журнал периода всей компании — тот же ключ, что у командного отбора ниже,
  // лишнего запроса нет: из него добираются строки без команды.
  const companyLedgerQuery = useTransactions(period.from, period.to);
  const teamlessKnown =
    companyLedgerQuery.data !== undefined && companyDebtsQuery.data !== undefined;
  const hasTeamless = useMemo(
    () =>
      hasTeamlessMoney({
        appointments: appts,
        debts: companyDebtsQuery.data ?? [],
        companyRows: companyLedgerQuery.data ?? [],
        accountTeam,
      }),
    [appts, companyDebtsQuery.data, companyLedgerQuery.data, accountTeam],
  );
  // ЧИП «БЕЗ КОМАНДЫ» ЖИВЁТ, ПОКА У ДЕНЕГ НЕТ КОМАНДЫ: счета-сироты ИЛИ записи,
  // долги и строки журнала без команды не на счёте команды. Раньше его держали
  // только сироты, и такие деньги не показывались нигде (находки 2026-09-15).
  // Сотруднику чипа «Без команды» нет вовсе: общие счета компании и деньги без
  // команды — не его календарь, а сервер ему их и не отдаёт.
  const needsNoTeamChip = access.noTeamChip && (hasOrphanAccounts || hasTeamless);
  const scopeChipTeams = useMemo(
    () => (needsNoTeamChip ? [...teams, NO_TEAM_CHIP] : teams),
    [needsNoTeamChip, teams],
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
    // Функцией от очереди (`fallbackScopeUpdate`): команда счёта из адреса,
    // поставленная в этом же кадре, не затирается первой командой. Сироты
    // розданы — у тенанта без команд скоуп уходит в null, иначе экран ждал бы
    // отключённый запрос вечно.
    setScope(
      fallbackScopeUpdate({
        teamIds: teams.map((team) => team.id),
        // Уводить с «Без команды» можно, только когда известно, что денег без
        // команды нет: пока журнал и долги едут, чип нельзя объявить пустым.
        accountsLoaded: accountsLoaded && teamlessKnown,
        hasOrphans: needsNoTeamChip,
      }),
    );
  }, [accountsLoaded, teamlessKnown, needsNoTeamChip, scope, setScope, teams, teamsQuery.isSuccess]);
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

  // Отбор журнала под чип — один на текущий и прошлый период («Прибыль»).
  const ledgerFilter =
    scope === NO_TEAM
      ? orphanAccounts.length > 0
        ? {
            // Журнал бесхозных счетов режется по СЧЕТАМ, а не по team_id:
            // их проводки могут нести team_id живых команд (сдача выручки
            // старой схемы), и командный срез потерял бы эти деньги.
            accountIds: orphanAccounts.map((account) => account.id),
          }
        : // Сирот нет — ноль строк, как `.in("team_id", ["__no_team__"])` на
          // сервере. Пустой `accountIds` значил бы «фильтра нет», а ключ
          // компании теперь почти всегда в кэше: `enabled: false` больше
          // ничего не прятал бы, и чип показал бы журнал всей компании.
          { brigadeIds: [NO_TEAM] }
      : { brigadeIds: scope ? [scope] : undefined };
  const transactionsQuery = useTransactions(period.from, period.to, ledgerFilter);
  const txs = useMemo(
    () => transactionsQuery.data ?? [],
    [transactionsQuery.data],
  );

  // Строки без команды добираются из той же выборки компании: командный отбор
  // их не видит, а деньги их лежат на счетах (`team-scope.ts`).
  const teamlessRows = useMemo(
    () => teamlessLedgerRows(companyLedgerQuery.data ?? [], scope, accountTeam),
    [companyLedgerQuery.data, scope, accountTeam],
  );
  // Видимое по строке — до любых итогов и лент: лента «Записи», «Счета» и
  // плитки считают одно и то же множество.
  const scopedTransactions = useMemo(() => {
    const rows = readableTransactions(withTeamlessRows(txs, teamlessRows), readRules, debtTeams);
    return requestedClientId
      ? rows.filter((transaction) => transaction.client_id === requestedClientId)
      : rows;
  }, [requestedClientId, txs, teamlessRows, readRules, debtTeams]);

  // Счёт = одна команда (2026-08-15): командный скоуп видит РОВНО счета
  // своей команды, «общих счетов» больше нет; чип «Без команды» показывает
  // сирот старой схемы. Скрытые балансы ВХОДЯТ в Σ (решение владельца:
  // маркер-глазик у плитки снят).
  const scopedAccounts = useMemo(() => {
    if (scope === NO_TEAM) return orphanAccounts;
    return scope ? accounts.filter((a) => accountServesTeam(a, scope)) : accounts;
  }, [accounts, orphanAccounts, scope]);
  // Одна цифра «сколько у нас денег» на весь продукт: плитка «Счета» считает
  // сумму видимых счетов. СКРЫТЫЙ счёт (владелец 03.10: «накопительный, для
  // себя») в неё не входит — его деньги видны только на странице «Счета».
  // Разбивки по видам счетов здесь НЕТ (владелец 2026-08-11): плитка отвечает
  // «сколько у команды», а не «сколько из этого наличными» — второй вопрос
  // задают плитками счетов под ней, глядя на конкретный счёт.
  const accountsSummary = useMemo(
    () => ({ total: accountsTotal(scopedAccounts) }),
    [scopedAccounts],
  );

  const materialSummary = useMemo(() => {
    // Материалы записей — деньги из записей: сотруднику записи приходят с
    // нулями, и такая цифра была бы выдумкой (`access.recordMoney`).
    if (!access.recordMoney) {
      return { amount: 0, appointmentCount: 0, byService: new Map<string, number>() };
    }
    const { amount, appointmentCount, costly } = periodMaterials(
      scopedAppointments,
      services,
      { from: period.from, to: period.to, scope },
      true,
    );
    // Те же записи — по услугам: «Прибыль» подписывает услугу её материалами.
    return { amount, appointmentCount, byService: materialsByService(costly, services) };
  }, [access.recordMoney, period.from, period.to, scope, scopedAppointments, services]);

  // «ПРИБЫЛЬ» К ПРОШЛОМУ ПЕРИОДУ — только пока открыта панель прибыли
  // (владелец 30.09: «аналитику такую — только в прибыли»; `profit-compare.ts`).
  // Запрос тот же, что у текущего периода: журнал компании за диапазон одним
  // ключом, отбор чипа и строки без команды — теми же правилами.
  const compareOn = view === "profit";
  const prevRange = useMemo(
    () => previousPeriod(period.from, period.to, businessToday),
    [period.from, period.to, businessToday],
  );
  const prevTeamQuery = useTransactions(prevRange.from, prevRange.to, {
    ...ledgerFilter,
    enabled: compareOn,
  });
  const prevCompanyQuery = useTransactions(prevRange.from, prevRange.to, {
    enabled: compareOn,
  });
  const profitBefore = useMemo(() => {
    // Заглушка — это данные ДРУГОГО диапазона: «было» из неё было бы ложью.
    if (
      !compareOn ||
      !prevTeamQuery.data ||
      !prevCompanyQuery.data ||
      prevTeamQuery.isPlaceholderData ||
      prevCompanyQuery.isPlaceholderData
    ) {
      return null;
    }
    const rows = withTeamlessRows(
      prevTeamQuery.data,
      teamlessLedgerRows(prevCompanyQuery.data, scope, accountTeam),
    );
    const transactions = requestedClientId
      ? rows.filter((transaction) => transaction.client_id === requestedClientId)
      : rows;
    const materials = periodMaterials(
      scopedAppointments,
      services,
      { from: prevRange.from, to: prevRange.to, scope },
      access.recordMoney,
    );
    return {
      ...periodMoney(transactions, materials.amount),
      from: prevRange.from,
      to: prevRange.to,
      transactions,
      materialCost: materials.amount,
    };
  }, [
    compareOn,
    prevTeamQuery.data,
    prevTeamQuery.isPlaceholderData,
    prevCompanyQuery.data,
    prevCompanyQuery.isPlaceholderData,
    scope,
    accountTeam,
    requestedClientId,
    scopedAppointments,
    services,
    prevRange.from,
    prevRange.to,
    access.recordMoney,
  ]);

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
    // Правило «эта работа уже под счётом» живёт ОДНОЙ функцией на продукт
    // (`invoicedAppointmentIds`): им считают и плитка «Долги», и лента под ней,
    // и `DebtorsList`. Аннулированные, отменённые и сами кредит-ноты из набора
    // выпадают — тест правила лежит рядом с ним.
    () => invoicedAppointmentIds(invoices),
    [invoices],
  );

  // Пустышки через useMemo, а не `?? []` в выражении: новый литерал на каждый
  // рендер ломает мемоизацию списка долгов, ради которой он и написан.
  const debts = useMemo(() => {
    // «Долги: Не видит» в команде долга — его нет ни в ленте, ни в плитке.
    const rows = readableDebts(debtsQuery.data ?? [], readRules);
    // Ручной долг, заведённый под «Без команды», пишется без команды — и здесь
    // же обязан найтись (раньше не показывался ни под одним чипом).
    const scoped = scope === NO_TEAM ? rows.filter((debt) => debt.team_id == null) : rows;
    // «Финансы клиента»: записи, инвойсы и операции уже сужены до него, а
    // ручные долги — нет, и чужой долг стоял в его плитке (аудит 2026-09-30).
    return requestedClientId
      ? scoped.filter((debt) => debt.client_id === requestedClientId)
      : scoped;
  }, [debtsQuery.data, scope, requestedClientId, readRules]);
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
    // visit as fully unpaid (same helper as the dashboard).
    let debt = 0;
    for (const a of access.recordMoney ? scopedAppointments : []) {
      // ОДНА КОРЗИНА. Завершённый визит без оплаты и прошедшая запись, по
      // которой бригадир не отчитался, — для владельца это одни и те же
      // неполученные деньги: «всё равно нужно принимать решение по клиенту»
      // (2026-08-09). Отдельная строка «Не закрыто» делила одно надвое.
      // Прошла — по часам компании, как в календаре: сегодняшняя запись,
      // чьё время кончилось, уже долг (повторный аудит 03.10).
      if (a.status === "cancelled") continue;
      if (!isPastRecord(a, businessToday, businessNowHm)) continue;
      // Долги — за выбранный период, как список под плиткой (владелец 03.10).
      if (a.date < period.from || a.date > period.to) continue;
      // Тем же правилом, что лента долгов (`debtRows`): на «Без команды»
      // плитка не брала ни одной записи, а лента — все записи компании.
      if (!inTeamScope(a.team_id, scope)) continue;
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
    access.recordMoney,
    manualIncomingDebt,
    scopedTransactions,
    scopedAppointments,
    invoicedAppointments,
    businessToday,
    businessNowHm,
    period.from,
    period.to,
    scope,
    materialSummary.amount,
  ]);

  // ПЛИТКА ЗАКРЫТОГО БЛОКА — СЕРАЯ И ПО НУЛЯМ (владелец 15.09), а не последнее,
  // что успело приехать до понижения прав.
  const shownTotals = useMemo(
    () => ({
      income: access.income === "locked" ? 0 : totals.income,
      expense: access.expense === "locked" ? 0 : totals.expense,
      profit:
        access.income === "locked" || access.expense === "locked" || !access.recordMoney
          ? 0
          : totals.profit,
      debt: access.debts === "locked" ? 0 : totals.debt,
    }),
    [access.debts, access.income, access.expense, access.recordMoney, totals],
  );

  // Σ refunds already issued against each income — caps further refunds.
  // NOT computed from the period-windowed txs: a refund is dated TODAY and
  // can land outside the viewed period (e.g. refunding a June income while
  // browsing «Прошлый месяц» on July 2) — the windowed sum would reset to 0
  // and let repeat refunds silently overdraw the ledger.
  const refundTotalsQuery = useRefundTotals();
  const refundTotals = refundTotalsQuery.data;
  // Σ ВОЗВРАТОВ — ВНЕ ПОЛНОГО ГЕЙТА (аудит финансов 2026-09-24). Витрина
  // операции и лист правки уже консервативны без неё: `alreadyRefunded` /
  // `refundedTotal` ниже подставляют Infinity, пока `refundTotals`
  // не приехал, — «Создать возврат» гасится сам, а не ждёт всей компании.
  // Держать эту цифру в общем гейте значило прятать ВЕСЬ экран (журнал,
  // счета, долги — всё готово) ради одного запроса, который нужен только
  // форме возврата; тот же трюк уже применили к «Долгам платежей» нельзя —
  // там цена ошибки другая (закрытый долг мигнул бы открытым), а тут кап
  // просто не предлагается, пока не известен.
  const refundTotalsLoading = refundTotalsQuery.isPending;
  const refundTotalsFailed =
    refundTotalsQuery.data === undefined && refundTotalsQuery.error != null;

  // Every number on this screen combines several independent sources. Do not
  // render plausible-looking zeroes when one of them is still loading or has
  // failed: a user can otherwise make a financial decision from an
  // incomplete ledger without any visible warning.
  // isPending, не isLoading: офлайн-paused запрос (isFetching=false) иначе
  // проваливался под гейт и рисовал нулевой P&L как настоящие данные.
  // Журнал и долги — вне полного гейта: смена периода не должна прятать весь
  // экран (хуки держат прошлые данные своей компании до прихода новых); первый
  // заход и холодная компания ловятся `isPending` без данных. Суммы платежей
  // по долгам окна не имеют и заглушки не держат — ждём их целиком: без них
  // закрытый долг на миг выглядел бы открытым.
  const loading =
    (transactionsQuery.isPending && transactionsQuery.data === undefined) ||
    (debtsQuery.isPending && debtsQuery.data === undefined) ||
    debtPaidQuery.isPending ||
    categoriesQuery.isPending ||
    teamsQuery.isPending ||
    servicesQuery.isPending ||
    appointmentsQuery.isPending ||
    clientsQuery.isPending ||
    invoicesQuery.isPending ||
    invoicePaymentsQuery.isPending ||
    accountsQuery.isPending ||
    calendarSettingsQuery.isPending;
  // Смена периода: прошлый срез ещё на экране, подпись уже новая. Такие цифры
  // гасятся (§8) — подменять деньги молча нельзя, по ним принимают решения.
  // Смена КОМАНДЫ сюда больше не попадает: журнал и долги читаются ключом
  // компании, команду отбирает `select` в том же кадре. Долги гасятся вместе с
  // журналом: плитка «Долги» складывает обоих.
  const stale = transactionsQuery.isPlaceholderData || debtsQuery.isPlaceholderData;
  const loadError =
    (transactionsQuery.data === undefined ? transactionsQuery.error : null) ||
    (debtsQuery.data === undefined ? debtsQuery.error : null) ||
    (debtPaidQuery.data === undefined ? debtPaidQuery.error : null) ||
    (categoriesQuery.data === undefined ? categoriesQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (servicesQuery.data === undefined ? servicesQuery.error : null) ||
    (appointmentsQuery.data === undefined ? appointmentsQuery.error : null) ||
    (clientsQuery.data === undefined ? clientsQuery.error : null) ||
    (invoicesQuery.data === undefined ? invoicesQuery.error : null) ||
    (invoicePaymentsQuery.data === undefined ? invoicePaymentsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (calendarSettingsQuery.data === undefined ? calendarSettingsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      transactionsQuery.refetch(),
      debtsQuery.refetch(),
      debtPaidQuery.refetch(),
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
  // refetch: обновляются только активные подписки, данные стоят на своём
  // ключе и не мигают. Первый фокус пропускаем — маунт и так всё грузит.
  //
  // ОДИН НАБОР КЛЮЧЕЙ НА ОБЕ ДВЕРИ ОБНОВЛЕНИЯ: возврат по фокусу и жест
  // pull-to-refresh (U86) обязаны довозить одно и то же — две копии списка
  // разъехались бы на первой правке.
  //
  // ["debts"] — с 2026-09-15 обязательно. Раньше тап по команде менял ключ
  // долгов, и устаревший ключ перечитывался сам; теперь ключ один на компанию,
  // тап сети не трогает, и эти две двери — единственный путь, которым долги,
  // заведённые с другого устройства, доезжают до экрана.
  const qc = useQueryClient();
  const invalidateLedger = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["debts"] }),
        qc.invalidateQueries({ queryKey: ["accounts"] }),
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        // Чеки держат плитку «Документы» — без них она жила старым числом.
        qc.invalidateQueries({ queryKey: ["receipts"] }),
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
  // Потянули вниз — перечитать и записи: материалы и долги записей стоят в
  // «Расходе», «Прибыли» и «Долгах», а жили только на realtime. На фокусе
  // записи не трогаем — это полный список календаря.
  const pullRefresh = useCallback(
    () =>
      Promise.all([
        invalidateLedger(),
        qc.invalidateQueries({ queryKey: ["appointments"] }),
      ]),
    [invalidateLedger, qc],
  );
  const pull = usePullRefresh(pullRefresh);
  const refreshControl = (
    <RefreshControl
      refreshing={pull.refreshing}
      onRefresh={pull.onRefresh}
      tintColor={t.accent}
    />
  );

  // Плитка «Документы» — ШТУКИ (владелец 2026-08-11), и ровно те, что
  // откроются под ней (аудит 2026-09-29: «Документы 0», а в «Чеках» за тот же
  // месяц 1 чек — плитка считала только инвойсы, ждущие оплату). Один список
  // с панелью (`usePeriodDocuments`): число и строки не расходятся.
  const issuedDocuments = usePeriodDocuments({
    invoices: scopedInvoices,
    payments: invoicePayments,
    appointments: scopedAppointments,
    accounts,
    clients,
    clientId: requestedClientId,
    teamId: scope,
    period,
    today: businessToday,
  });
  // ДОКУМЕНТЫ — ПО ПРАВУ ЧИТАЮЩЕГО: инвойсы видит только владелец, чек — тот,
  // кому видна его операция. Журнал периода всей компании — тот же ключ, что
  // у ленты, лишнего запроса нет. Плитка и панель режут одним отбором.
  const ledgerById = useMemo(
    () => new Map((companyLedgerQuery.data ?? []).map((tx) => [tx.id, tx] as const)),
    [companyLedgerQuery.data],
  );
  const documentsReadable = useCallback<DocumentsReadable>(
    (documents, receipts) =>
      readableDocuments(documents, receipts, readRules, ledgerById, debtTeams),
    [readRules, ledgerById, debtTeams],
  );
  const periodDocuments = useMemo(
    () => ({
      documents: documentsReadable(issuedDocuments.documents, issuedDocuments.receipts),
    }),
    [documentsReadable, issuedDocuments.documents, issuedDocuments.receipts],
  );
  const invoiceSummary = useMemo(
    // Кредит-нота — сторно отменённого счёта, а не ещё один документ периода.
    () => ({ count: periodDocuments.documents.filter((d) => !d.creditNote).length }),
    [periodDocuments.documents],
  );

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
      access.recordMoney
        ? materialExpenseRows(scopedAppointments, services, {
            from: period.from,
            to: period.to,
            teamId: scope,
          })
        : [],
    [access.recordMoney, period.from, period.to, scope, scopedAppointments, services],
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
  //
  // Каждая строка называет свой счёт (владелец 2026-09-15): имена берутся со
  // всех счетов, включая закрытые, в порядке плиток — строка «Наличные ·
  // Карта» читается в том же порядке, что счета над ней.
  // Сотрудники — получатель выплаты зарплаты в строках и разборе
  // («Зарплата · Даня», `category-asks.ts`). С уволенными: старая выплата не должна
  // терять имя.
  const peopleData = useMasters({ includeInactive: true }).data;
  const people = useMemo(() => peopleData ?? [], [peopleData]);
  const recordRefs = useMemo(
    () => ({
      appointments: scopedAppointments,
      clients,
      services,
      categories,
      accounts: sortAccountRows(allAccounts),
      people,
      // Визит вне периода (предоплата сегодня за завтра) — строка днём денег.
      window: { from: period.from, to: period.to },
    }),
    [scopedAppointments, clients, services, categories, allAccounts, people, period.from, period.to],
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
    // Ручные долги идут В ТОЙ ЖЕ ленте: для владельца это одно событие дня —
    // «взяли кондиционеры у Gree и не заплатили» стоит рядом с деньгами того
    // же дня. Сторону в общей ленте называет отметка «Я должен»: переключателя
    // здесь нет, а без неё «должны нам» и «должны мы» выглядят одинаково.
    const debtBlocks =
      view === "all"
        ? [
            ...(access.recordMoney
              ? debtRows(scopedAppointments, clients, services, {
                  // Общая лента — лента периода: долги в ней того же окна.
                  // Остаток на сегодня — у плитки и панели «Долги».
                  from: period.from,
                  to: period.to,
                  today: businessToday,
                  nowHm: businessNowHm,
                  teamId: scope,
                  invoicedAppointmentIds: invoicedAppointments,
                })
              : []),
            ...manualDebtRows(
              // Лента периода: ручные долги того же окна.
              debts.filter((debt) => debt.occurred_on >= period.from && debt.occurred_on <= period.to),
              debtPaid,
              { clients, categories },
              { today: businessToday, markDirection: true },
            ),
          ].map((row) => ({ ...row, key: `debt:${row.key}` }))
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

    // Ищем по тому, что человек ВИДИТ в строке (`rowMatchesQuery`). Раньше
    // поиск шёл по проводкам — по невидимому.
    const all = [...income, ...expense, ...debtBlocks, ...transfers];
    // ОДНА ЗАПИСЬ — ОДНА СТРОКА (владелец 2026-09-09). В общей ленте состояния
    // одной работы склеиваются: доход главным числом, остальное подписью.
    // В разрезах склейки нет — там человек просил именно этот вид денег.
    return (view === "all" ? mergeByRecord(all) : all)
      .filter((row) => rowMatchesQuery(row, query))
      .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const at = a.time ?? "";
      const bt = b.time ?? "";
      if (at !== bt) return at < bt ? 1 : -1;
      return a.key < b.key ? 1 : -1;
      });
  }, [
    access.recordMoney,
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
    businessNowHm,
    scope,
    invoicedAppointments,
    debts,
    debtPaid,
    categories,
  ]);

  const toggleView = (v: HomeView) => {
    // «Документы» открываются там, где что-то есть: единственный чек месяца
    // прятался за пустой вкладкой «Инвойсы 0» (аудит 2026-09-30).
    if (v === "documents" && view !== "documents") {
      const docs = periodDocuments.documents;
      const has = (kind: DocumentFilter) => docs.some((d) => d.kind === kind);
      if (!has(docFilter) && docs.length > 0) {
        setDocFilter(has("invoice") ? "invoice" : "receipt");
      }
    }
    setView((prev) => (prev === v ? "all" : v));
  };

  // Real refund (web handleRefund): драфт собирает общий buildRefundDraft —
  // с наследованием НДС-снимка исходника.
  // Хаптик успеха НЕ здесь: возврат проводится только через TransactionPopup,
  // и сигналит он — второй вызов на экране давал двойную вибрацию.
  const handleRefund = async (tx: FinanceTransaction, amount: number, requestId: string) => {
    if (tx.source === "auto") {
      throw new Error("Возврат этой оплаты оформляется в связанной заявке.");
    }
    await insertTx.mutateAsync(buildRefundDraft(tx, amount, businessToday, requestId));
  };

  // Выгрузка операций для бухгалтера живёт в настройках финансов
  // (`LedgerExportRow`), а не на этом экране: здесь действие одно — в футере.

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
    // Под «Счетами» дорога несёт и счёт — если его лента правда на экране:
    // иначе возврат выбрал бы счёт, которого человек не видел.
    const shownAccount =
      view === "accounts" && scopedAccounts.some((a) => a.id === accountId)
        ? accountId
        : null;
    pushOnce(
      `/(dashboard)?appointmentId=${target.id}&date=${target.date}` +
        (target.team_id ? `&teamId=${target.team_id}` : "") +
        // Дорога назад: закрыв запись, человек возвращается в ленту денег, а не
        // остаётся в календаре (владелец 2026-08-15) — и в ТОТ ЖЕ разрез, из
        // которого ушёл: вкладка пересоздаётся, и «Доход» сбрасывался на «Все».
        // И в ту же команду чипа (аудит 2026-09-30): без неё вкладка вставала
        // на первую команду.
        `&from=${encodeURIComponent(financesFrom(view, { account: shownAccount, team: scope }))}`,
    );
    return true;
  };

  // Настройки — ПОЛНОЦЕННАЯ СТРАНИЦА (закон продукта). Здесь был системный
  // Alert со списком: он не умеет показывать текущие значения, и «включён ли
  // НДС» приходилось выяснять, проваливаясь внутрь.
  // Настройки открываются на команде, которую смотрят (владелец 2026-09-24:
  // «настройки в финансах по каждой команде»).
  const openFinanceSettings = () =>
    pushOnce(
      scope && scope !== NO_TEAM
        ? `/finances/settings?team=${encodeURIComponent(scope)}`
        : "/finances/settings",
    );

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
        // ДВЕРЬ ОТКРЫТА ВСЕМ (владелец 20.09: «я могу зайти туда, но блоков
        // уже внутри шестерёнки не будет»). Раньше у сотрудника шестерёнка
        // была серой и глухой — визуал шапки менялся вместе с правами.
        // Страница за ней показывает то, что человеку открыто, и ничего, если
        // не открыто ничего (`finances/settings-levels.ts`).
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
        style={{
          height: 36,
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          borderRadius: t.radius.input,
          backgroundColor: t.fill,
        }}
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
          // Искать нечего, когда ленты нет: у закрытых «Доходов и расходов»
          // поле серое и не принимает ввод.
          editable={access.search}
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={1.3}
          // МЕЖСТРОЧНЫЙ ИНТЕРВАЛ ЗАДАН ЯВНО, 18 = родной у 15pt (владелец
          // 2026-09-29: «поисковик как будто вниз сдвинулся»). Без него поле
          // получало интервал базовых стилей (1,5 кегля), и однострочное поле
          // iOS опускает текст ровно на этот излишек: подсказка стояла на
          // ~8pt ниже лупы, а с классом `text-[15px]` ещё и срезалась снизу.
          // Проверено на симуляторе: без высоты и без сброса отступов смещение
          // оставалось, пропало — только от интервала.
          style={{
            flex: 1,
            alignSelf: "stretch",
            fontSize: 15,
            lineHeight: 18,
            color: t.ink,
          }}
        />
      </View>

      {/* Аналитика — как в Клиентах: значок стоит всегда (владелец 20.09:
          «справа значок аналитики — он есть; если на него тапнуть,
          открывается, ну значит не будет данных там»). Что человек увидит
          внутри, решают его же права на записи и деньги. */}
      <Pressable
        onPress={() =>
          // Аналитика открывается на том же периоде, что был под значком, и
          // на всей компании — команду в ней выбирают тапом.
          router.push({
            pathname: "/finances/insights",
            params: {
              period: period.preset,
              from: period.from,
              to: period.to,
            },
          })
        }
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
    </View>
  );

  // Счётчик считает ПОКАЗАННОЕ. Лента считает записями, а не проводками:
  // «Операции · 19» над одним визитом читалось как девятнадцать дел
  // (2026-09-09).
  const feedTitle = panelCount(
    view === "income" ? "Доход" : view === "expense" ? "Расход" : "Записи",
    blockRows.length,
  );

  // ПОИСК ЗА ВСЁ ВРЕМЯ, КОГДА В ПЕРИОДЕ ПУСТО (аудит финансов 2026-09-24).
  // Шапка обещает «Сумма, счёт, заметка», а лента грузится окном периода:
  // первая же буква находила ноль, даже когда операция стояла за прошлый
  // месяц. Фолбэк — только по заметке (её и пишут руками) и только когда
  // открытый период честно пуст: лишний поход в сеть на каждую букву не
  // нужен, пока в периоде есть результат.
  const trimmedQuery = query.trim();
  const recordSearchView = view === "all" || view === "income" || view === "expense";
  const searchInPeriodEmpty =
    recordSearchView && trimmedQuery.length > 0 && blockRows.length === 0;
  const allTimeSearchQuery = useQuery({
    queryKey: ["transactions", tenantId, "search-all-time", trimmedQuery],
    enabled: !!tenantId && searchInPeriodEmpty,
    queryFn: async (): Promise<FinanceTransaction[]> => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .ilike("notes", containsPattern(trimmedQuery))
        .order("occurred_on", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FinanceTransaction[];
    },
  });
  // Те же рамки, что у ленты: чип команды (строки без команды — по команде
  // счёта), клиент из диплинка и разрез. Иначе под «Доходом» Команды 1
  // поиск показывал бы и расходы, и чужие команды.
  const allTimeRows = useMemo(() => {
    if (!searchInPeriodEmpty) return [];
    // Тем же отбором по строке, что лента: в зеркале поиск идёт токеном
    // владельца и нашёл бы скрытую сторону.
    const found = readableTransactions(allTimeSearchQuery.data ?? [], readRules, debtTeams);
    const orphanIds = new Set(orphanAccounts.map((account) => account.id));
    const teamRows = !scope
      ? found
      : withTeamlessRows(
          scope === NO_TEAM
            ? found.filter((tx) => tx.account_id != null && orphanIds.has(tx.account_id))
            : found.filter((tx) => tx.team_id != null && inTeamScope(tx.team_id, scope)),
          teamlessLedgerRows(found, scope, accountTeam),
        );
    const rows = requestedClientId
      ? teamRows.filter((tx) => tx.client_id === requestedClientId)
      : teamRows;
    const income =
      view === "expense"
        ? []
        : recordRows(incomeDeals(rows), recordRefs).map((row) => ({
            ...row,
            tone: "income" as const,
            key: `income:${row.key}`,
          }));
    const expense =
      view === "income"
        ? []
        : recordRows(rows.filter((tx) => tx.type === "expense"), recordRefs).map(
            (row) => ({ ...row, tone: "expense" as const, key: `expense:${row.key}` }),
          );
    const transfers =
      view === "all"
        ? recordRows(rows.filter((tx) => tx.type === "transfer"), recordRefs).map(
            (row) => ({ ...row, key: `tr:${row.key}` }),
          )
        : [];
    return [...income, ...expense, ...transfers];
  }, [
    searchInPeriodEmpty,
    allTimeSearchQuery.data,
    readRules,
    debtTeams,
    orphanAccounts,
    scope,
    accountTeam,
    requestedClientId,
    view,
    recordRefs,
  ]);

  // СТРОКА ЛЮБОЙ ПАНЕЛИ ВЕДЁТ В ОДНО МЕСТО — и в разрезах «Доход / Расход /
  // Долги», и в ленте счёта под «Счетами»: одна дверь на одну строку.
  // СВАЙП «УДАЛИТЬ» В ЛЕНТЕ (владелец 03.10: «удалить операцию — не кнопка
  // внизу»; «только у тех, что создаём своими руками»). Строка — одиночная
  // ручная операция (`deletableByHand`), право — то же, что у правки строки
  // и у витрины (`allow.remove` ниже): перевод и ручной возврат — владельцу.
  // Счёт операции закрыт или удалён — сервер удаление не примет, свайпа нет.
  const rowTx = (row: RecordRow): FinanceTransaction | null =>
    row.txId
      ? (scopedTransactions.find((x) => x.id === row.txId) ??
        (allTimeSearchQuery.data ?? []).find((x) => x.id === row.txId) ??
        null)
      : null;
  const liveAccountIds = new Set((transferAccountsQuery.data ?? []).map((a) => a.id));
  const canDeleteRow = (row: RecordRow): boolean => {
    if (!row.txId || row.appointmentId || row.debtId) return false;
    const tx = rowTx(row);
    if (!tx || !deletableByHand(tx)) return false;
    if (tx.account_id && !liveAccountIds.has(tx.account_id)) return false;
    if (tx.type === "transfer" || tx.type === "refund") return access.owner;
    return access.txEditable(tx, {
      account: allAccounts.find((a) => a.id === tx.account_id) ?? null,
      debt: debts.find((d) => d.id === tx.debt_id) ?? null,
    });
  };
  const deleteRow = (row: RecordRow) => {
    const tx = rowTx(row);
    if (!tx) return;
    // Доход с возвратом сервер не удалит — причина словами до вопроса.
    if (refundBlocksDelete(tx, refundTotals ? (refundTotals.get(tx.id) ?? 0) : undefined)) {
      haptics.warning();
      notify("Удалить нельзя", "По этому доходу есть возврат — сначала удалите возврат.");
      return;
    }
    const text = tx.type === "transfer" ? deleteTransferAlert() : deleteOperationAlert();
    confirmThen(
      text.title,
      { message: text.message, confirmLabel: text.confirm, destructive: true },
      async () => {
        try {
          if (tx.type === "transfer" && tx.transfer_group_id) {
            await delTransfer.mutateAsync(tx.transfer_group_id);
          } else {
            await delTx.mutateAsync(tx.id);
          }
          haptics.success();
        } catch (e) {
          const words = writeErrorWords(e, {
            failed: "Не удалось удалить",
            notDone: "Операция не удалена",
          });
          notify(words.title, words.subtitle);
        }
      },
    );
  };

  const openRecordRow = (row: RecordRow) => {
    // ДЕНЬГИ ПО ЗАПИСИ ОТКРЫВАЮТ САМУ ЗАПИСЬ (владелец 2026-08-15).
    if (row.appointmentId && openAppointment(row.appointmentId)) return;
    // Ручной долг записи не имеет — открывается он сам.
    if (row.debtId) {
      const found = debts.find((d) => d.id === row.debtId);
      if (!found) return;
      setEditingDebt(found);
      setDebtOpen(true);
      return;
    }
    // Одиночная операция — бензин, обед, перевод — открывается на
    // правку: другой двери к ней на экране нет. Витрина остаётся
    // тому, что править нельзя (перевод, проводка инвойса). Строка могла
    // приехать поиском за всё время — её в `scopedTransactions` (окно
    // периода) не найти, ищем и там, и там.
    const tx = row.txId
      ? (scopedTransactions.find((x) => x.id === row.txId) ??
        (allTimeSearchQuery.data ?? []).find((x) => x.id === row.txId))
      : null;
    if (!tx) return;
    // ПРАВКА — ПО УРОВНЮ КАЛЕНДАРЯ САМОЙ СТРОКИ, а не выбранного чипа: у
    // сотрудника сервер отдаёт на правку только свой расход на счёте своей
    // команды. Нельзя — открывается витрина, а не форма с кнопкой в отказ.
    if (
      access.txEditable(tx, {
        account: allAccounts.find((a) => a.id === tx.account_id) ?? null,
        debt: debts.find((d) => d.id === tx.debt_id) ?? null,
      })
    ) {
      setEditingTx(tx);
      setOpOpen(true);
      return;
    }
    setPopupTx(tx);
  };

  // ЛЕНТА КОМАНД И ПЕРИОД — И ПОКА ГРУЗИТСЯ, И КОГДА СЕРВЕР МОЛЧИТ (владелец
  // 03.10: «календарь, когда не грузится, показывает команды сверху… в
  // финансах то же самое должно быть»). Та же полоса, что над сводкой, —
  // при ответе сервера экран не прыгает. Без ответа период глухой: выбирать
  // его не для чего, цифр за ним нет.
  const scopeBar = (locked: boolean) => (
    <ScopePeriodBar
      teams={scopeChipTeams}
      scopeTeamId={scope}
      onScopeChange={changeScope}
      period={period}
      onOpenPresets={() => setPresetOpen(true)}
      onOpenCustom={() => setWheelsOpen(true)}
      locked={locked}
    />
  );

  if (loading) {
    return (
      <Screen edges={["top"]}>
        {header}
        {scopeBar(false)}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    // Обрыв — словами, а не «TypeError: Network request failed» (03.10).
    const words = loadErrorWords(loadError, {
      failed: "Не удалось загрузить финансы",
      later: "Финансы загрузятся, как только сервер ответит.",
    });
    return (
      <Screen edges={["top"]}>
        {header}
        {scopeBar(true)}
        <EmptyState
          state="error"
          fill
          title={words.title}
          subtitle={words.subtitle}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      {header}
      {/* Пока едет новый срез, цифры прошлого периода ГАСНУТ, а не выдаются за
          новые. Журнал и долги держат прошлый период, чтобы экран не мигал
          пустотой, — но только своей компании (`placeholderWithinTenant`):
          деньги другой компании сюда не попадают никогда, холодная компания
          идёт в скелет (`loading`), а не под вуаль. Под новой подписью периода
          это всё равно чужие цифры, и решение по ним принимать нельзя —
          поэтому гаснут и журнал, и плитка «Долги». Полоска под шапкой
          говорит, что работа идёт. */}
      <LoadingBar visible={stale} />

      <View style={{ flex: 1, opacity: stale ? 0.4 : 1 }}>
        <FinanceOverview
          teams={scopeChipTeams}
          scopeTeamId={scope}
          onScopeChange={changeScope}
          period={period}
          onOpenPresets={() => setPresetOpen(true)}
          onOpenCustom={() => setWheelsOpen(true)}
          totals={shownTotals}
          accounts={access.accounts === "locked" ? { total: 0 } : accountsSummary}
          invoices={invoiceSummary}
          showDocuments={access.has.documents}
          documentsTariffLocked={!canUseDocuments}
          showAccounts={access.has.accounts}
          showDebts={access.has.debts}
          lockAccounts={access.accounts === "locked"}
          lockIncome={access.income === "locked"}
          lockExpense={access.expense === "locked"}
          lockProfit={!access.recordMoney}
          lockDebts={access.debts === "locked"}
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
            transactions={scopedTransactions}
            refs={recordRefs}
            selectedId={accountId}
            onSelect={setAccountId}
            onOpen={pushOnce}
            onOpenRecord={openRecordRow}
            refreshControl={refreshControl}
            canOpenSettings={access.settings}
            // Настройки — на счетах выбранной команды (владелец 03.10).
            teamId={scope}
          />
        ) : view === "documents" ? (
          <DocumentsPanel
            // Документы выставляет владелец: у остальных панель не обещает
            // кнопку, которой у них нет (владелец 20.09).
            canIssue={access.documents}
            readable={documentsReadable}
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
            materialsByService={materialSummary.byService}
            compare={profitBefore}
            people={people}
            refreshControl={refreshControl}
          />
        ) : view === "debt" ? (
          <DebtorsList
            appointments={access.recordMoney ? scopedAppointments : []}
            clients={clients}
            services={services}
            teamId={scope}
            // Долги выбранного периода (владелец 03.10, вечер).
            fromDate={period.from}
            toDate={period.to}
            todayYmd={businessToday}
            nowHm={businessNowHm}
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
            onOpenDocuments={
              canUseDocuments
                ? () => {
                    setDocFilter("invoice");
                    setView("documents");
                  }
                : undefined
            }
            refreshControl={refreshControl}
          />
        ) : (
          <View style={{ flex: 1 }}>
            {/* ПОИСК ЗА ВСЁ ВРЕМЯ — СЛОВАМИ, а не молчаливым нулём: период
                честно пуст, но операция может стоять за его границей. */}
            {searchInPeriodEmpty ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  paddingHorizontal: GUTTER,
                  paddingTop: 12,
                  paddingBottom: 4,
                  textAlign: "center",
                  fontSize: 13,
                  color: t.sub,
                }}
              >
                {allTimeSearchQuery.isPending
                  ? "В этом периоде нет — ищем за всё время…"
                  : allTimeRows.length > 0
                    ? "В этом периоде нет — найдено за всё время"
                    : "В этом периоде нет"}
              </Text>
            ) : null}
            <RecordRowsPanel
              rows={searchInPeriodEmpty ? allTimeRows : blockRows}
              title={searchInPeriodEmpty ? undefined : feedTitle}
              emptyTitle={
                searchInPeriodEmpty
                  ? "Не нашли и за всё время"
                  : query.trim()
                    ? "В выбранном периоде ничего не найдено"
                    : view === "income"
                      ? "Дохода за период нет"
                      : view === "expense"
                        ? "Расхода за период нет"
                        : "Нет операций за период"
              }
              refreshControl={refreshControl}
              onOpenRecord={openRecordRow}
              canDeleteRow={canDeleteRow}
              onDeleteRow={deleteRow}
            />
          </View>
        )}
      </View>

      {/* Главное действие экрана и листы счетов — `FinancesFooter`. */}
      <FinancesFooter
        view={view}
        debtSide={debtSide}
        teamById={teamByIdAll}
        teamId={scope === NO_TEAM ? null : scope}
        accounts={accounts}
        transferAccounts={transferAccountsQuery.data}
        shownAccounts={scopedAccounts}
        selectedAccountId={view === "accounts" ? accountId : null}
        // Команда чипа — команда счёта (ставка VAT, касса, «Документы» этой
        // команды); без неё инвойс уходил первой команде (аудит 2026-09-30).
        onIssueInvoice={() =>
          pushOnce(
            scope && scope !== NO_TEAM
              ? `/invoices/new?teamId=${encodeURIComponent(scope)}`
              : "/invoices/new",
          )
        }
        onAddDebt={() => {
          setEditingDebt(null);
          setDebtOpen(true);
        }}
        onAddOperation={() => {
          setEditingTx(null);
          setOpOpen(true);
        }}
        // Главное действие экрана — по уровню ВЫБРАННОГО календаря: «Смотрит»
        // гасит кнопку и называет причину словами, закрытый блок — просто
        // гасит (страница и так серая по нулям).
        enabled={access.footer(view).enabled}
        reason={access.footer(view).reason}
      />

      <TransactionPopup
        visible={!!popupTx}
        transaction={popupTx}
        // Подписи строки — по ВСЕМ счетам: перевод на скрытый накопительный
        // терял ноги «Откуда/Куда» и показывал одну сторону (аудит 03.10).
        accounts={allAccounts}
        teams={allTeams}
        categories={categories}
        people={people}
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
        refundTotalsLoading={refundTotalsLoading}
        refundTotalsError={refundTotalsFailed}
        // Что этому человеку открыто: возврат и инвойс пока владельческие, а
        // удаление — ровно то же правило, что у правки строки. Отмена перевода
        // сотруднику не открывается: вторую ногу знает только сама витрина, а
        // сервер требует «Меняет» по обоим счетам.
        allow={{
          refund: access.refunds,
          invoice: access.documents,
          remove: popupTx
            ? popupTx.type === "transfer"
              ? access.owner
              : // Ошибочный ручной возврат владелец убирает сам: правкой он не
                // открывается (сумма привязана к доходу), а удалить его было
                // негде (аудит 2026-09-30). Возврат оплаты записи или инвойса —
                // только из его двери.
                popupTx.type === "refund"
                ? access.owner && popupTx.source === "manual" && !popupTx.invoice_id
                : access.txEditable(popupTx, {
                  account: allAccounts.find((a) => a.id === popupTx.account_id) ?? null,
                  debt: debts.find((d) => d.id === popupTx.debt_id) ?? null,
                })
            : false,
        }}
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
        // Лист знает только «можно ли писать» — правило живёт на экране:
        // правка — по строке (своя или «Правит всё»), платёж по долгу — по
        // «Долги: Принимает оплату», новая операция — по своей стороне денег в
        // выбранном календаре.
        canWrite={
          editingTx
            ? access.txEditable(editingTx, {
                account: allAccounts.find((a) => a.id === editingTx.account_id) ?? null,
                debt: debts.find((d) => d.id === editingTx.debt_id) ?? null,
              })
            : debtPayment
              ? (() => {
                  const paid = [editingDebt, ...debts].find(
                    (d) => d?.id === debtPayment.debtId,
                  );
                  return !!paid && access.debtPayable(paid);
                })()
              : access.ops === "write"
        }
        canWriteType={access.canAdd}
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
        // Лист уезжает на время похода за новым клиентом — маршрут карточки
        // под окном шторки не виден — и возвращается этим.
        onReopen={reopenDebtSheet}
        paid={editingDebt ? debtPaid.get(editingDebt.id) ?? 0 : 0}
        // Долг правится по уровню СВОЕГО календаря, а гасится ещё и уровнем
        // «Доходов и расходов»: платёж — это операция журнала.
        canWrite={editingDebt ? access.debtEditable(editingDebt) : access.debts === "write"}
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
