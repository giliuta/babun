import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BarChart3, Search, Settings, X } from "lucide-react-native";
import { signedAmount, type FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { summarizeVat } from "@babun/shared/local/finance/vat";
import { visibleAccountsTotal } from "@/features/finances/account-ui";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import { appointmentMaterialCost } from "@babun/shared/local/finance/appointment-calc";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useServices } from "@/features/services/queries";
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
import { ProfitBreakdown } from "@/features/finances/ProfitBreakdown";
import { DebtorsList } from "@/features/finances/DebtorsList";
import { TransactionsFeed } from "@/features/finances/TransactionsFeed";
import { TransactionPopup } from "@/features/finances/TransactionPopup";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
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
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useToast } from "@/components/ui/Toast";
import { shareCsvFile } from "@/lib/share-csv";
import { financeTransactionsToCsv } from "@/features/finances/export";

function FinancesContent() {
  const t = useThemeColors();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{
    clientId?: string | string[];
    /** Nonce со страницы настроек: «Отчёт бухгалтеру» живёт там, а данные
     *  (период и срез) — здесь. Отдельный экран ради выгрузки не нужен. */
    exportReport?: string;
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
  const pushOnce = (href: "/accounts" | "/documents" | "/finances/settings") => {
    const now = Date.now();
    if (now - lastPushRef.current < 700) return;
    lastPushRef.current = now;
    router.push(href);
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
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [view, setView] = useState<HomeView>("all");
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);

  const categoriesQuery = useFinanceCategories();
  const teamsQuery = useTeams();
  // Активные — для чипов скоупа; ВСЕ (вкл. удалённые) — для подписей
  // истории: лента/попап/CSV не должны терять имя расформированной команды.
  const allTeamsQuery = useTeams({ includeInactive: true });
  const servicesQuery = useServices();
  const appointmentsQuery = useAppointments();
  const clientsQuery = useClients();
  const invoicesQuery = useInvoices();
  const invoicePaymentsQuery = useInvoicePayments();
  const accountsQuery = useAccountsWithBalances();
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  // ДЕНЬГИ ВСЕГДА ЧЬИ-ТО. Владелец 2026-08-10: «компания в целом не нужна,
  // только разбивка по командам — итог по компании смотрят в сводках».
  // Поэтому скоуп никогда не бывает пустым: открываем ту команду, с которой
  // человек работает, а если её удалили — первую живую.
  useEffect(() => {
    if (!teamsQuery.isSuccess || teams.length === 0) return;
    if (!scope || teams.every((team) => team.id !== scope)) {
      setScope(teams[0].id);
    }
  }, [scope, teams, teamsQuery.isSuccess]);
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
    scope ? [scope] : undefined,
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

  // Командный скоуп видит свои счета + общие, к которым команда подключена.
  const scopedAccounts = useMemo(
    () => (scope ? accounts.filter((a) => accountServesTeam(a, scope)) : accounts),
    [accounts, scope],
  );
  // Σ мини-карточки: в командном скоупе — только командные счета (полный
  // баланс общего умножался бы на число команд при переключении чипов).
  // Скрытые балансы ВХОДЯТ в Σ (решение владельца: маркер-глазик у плитки
  // снят; скрытие остатка живёт в списках и на странице счёта).
  const miniCardAccounts = useMemo(
    () =>
      scope ? scopedAccounts.filter((a) => a.scope === "team") : scopedAccounts,
    [scope, scopedAccounts],
  );
  // ОДНА ФОРМУЛА С ЭКРАНОМ СЧЕТОВ. Плитка складывала ВСЕ счета, включая
  // скрытые глазиком, а страница «Счета» — только видимые: на один вопрос
  // «сколько у нас денег» два разных числа. Хуже, скрытый остаток
  // восстанавливался вычитанием, и глазик переставал что-либо скрывать.
  const acctVisible = useMemo(
    () => visibleAccountsTotal(miniCardAccounts),
    [miniCardAccounts],
  );
  const acctTotal = acctVisible.total;
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
    // ОДНИ И ТЕ ЖЕ ДЕНЬГИ СЧИТАЮТСЯ ОДИН РАЗ.
    //
    // «Долги» — работа сделана, деньги не получены и ничем не оформлены.
    // Как только на эту работу выставлен инвойс, те же деньги показывает
    // плитка «Документы» («ждут оплату»). Без этого исключения одна сотня
    // евро сидела в обеих цифрах сразу, и прибыль с долгами врали вместе.
    // Аннулированный инвойс не считается — он ничего не ждёт.
    const invoicedAppointments = new Set(
      invoices
        .filter(
          (inv) =>
            inv.appointment_id &&
            inv.status !== "void" &&
            inv.status !== "cancelled",
        )
        .map((inv) => inv.appointment_id as string),
    );
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
    // НДС — ЧУЖИЕ ДЕНЬГИ ВНУТРИ ОБОРОТА. В кассу пришло 480, но 400 — твоё,
    // а 80 держишь для государства. Считать все 480 доходом значит завысить
    // прибыль ровно на эти 80 и узнать об этом в конце квартала.
    const vat = summarizeVat(scopedTransactions);
    return {
      income,
      expense: expenseWithMaterials,
      profit: income - expenseWithMaterials,
      debt,
      vat,
    };
  }, [
    scopedTransactions,
    scopedAppointments,
    invoices,
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

  const invoiceSummary = useMemo(() => {
    let openCount = 0;
    let outstanding = 0;
    let overdue = 0;
    for (const invoice of scopedInvoices) {
      if (invoice.status === "void") continue;
      if (scope && invoice.brigade_id !== scope) continue;
      const settlement = calculateInvoiceSettlement(
        invoice,
        invoicePayments[invoice.id] ?? [],
      );
      if (settlement.remaining <= 0) continue;
      openCount += 1;
      outstanding += settlement.remaining;
      if (invoice.due_on && invoice.due_on < businessToday) {
        overdue += settlement.remaining;
      }
    }
    return { openCount, outstanding, overdue };
  }, [businessToday, invoicePayments, scope, scopedInvoices]);

  // Словари для поиска: одна сборка на рендер вместо линейного поиска по
  // четырём массивам на каждую строку ленты при каждой букве.
  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const teamName = useMemo(
    () => new Map(allTeams.map((tm) => [tm.id, tm.name])),
    [allTeams],
  );

  // Feed filtered by the active overview card (web parity: feedTx).
  const feedTx = useMemo(() => {
    const byView =
      view === "income"
        ? scopedTransactions.filter(
            (tx) => tx.type === "income" || tx.type === "refund",
          )
        : view === "expense"
          ? scopedTransactions.filter((tx) => tx.type === "expense")
          : scopedTransactions;
    const needle = query.trim().toLowerCase();
    if (!needle) return byView;
    // Ищем по тому, что человек видит в строке: заметка, клиент, категория,
    // счёт, команда и сумма. Отдельного индекса не заводим — лента за период
    // и так лежит в памяти, а лишний индекс разошёлся бы с показанным.
    return byView.filter((tx) =>
      [
        tx.notes ?? "",
        clientName.get(tx.client_id ?? "") ?? "",
        categoryName.get(tx.category_id ?? "") ?? "",
        accountName.get(tx.account_id ?? "") ?? "",
        teamName.get(tx.team_id ?? "") ?? "",
        String(tx.amount),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [
    scopedTransactions,
    view,
    query,
    clientName,
    categoryName,
    accountName,
    teamName,
  ]);

  const toggleView = (v: HomeView) =>
    setView((prev) => (prev === v ? "all" : v));

  // Web parity: transfer legs are never editable; deleting removes BOTH
  // legs atomically by transfer_group_id — patching or deleting a single
  // leg would leave a half-transfer and corrupt account balances.
  const confirmDeleteTransfer = (tx: FinanceTransaction) => {
    Alert.alert(
      "Перевод между счетами",
      "Перевод нельзя редактировать. Удалить его целиком (обе операции)?",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить перевод",
          style: "destructive",
          onPress: async () => {
            try {
              if (tx.transfer_group_id) {
                await delTransfer.mutateAsync(tx.transfer_group_id);
              } else {
                throw new Error(
                  "У перевода повреждена связь между счетами. Операция не изменена.",
                );
              }
            } catch (e) {
              Alert.alert("Ошибка", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  // Real refund (web handleRefund): a negative row tied to the income via
  // refund_of_id, inheriting its account/team/category/method so the
  // money leaves the same pocket it entered.
  const handleRefund = async (tx: FinanceTransaction, amount: number) => {
    if (tx.source === "auto") {
      throw new Error("Возврат этой оплаты оформляется в связанной заявке.");
    }
    await insertTx.mutateAsync({
      type: "refund",
      amount: -Math.abs(amount),
      account_id: tx.account_id,
      team_id: tx.team_id,
      category_id: tx.category_id,
      payment_method: tx.payment_method,
      refund_of_id: tx.id,
      invoice_id: tx.invoice_id,
      occurred_on: businessToday,
      business_today: businessToday,
      notes: `Возврат по операции от ${tx.occurred_on}`,
    });
  };

  const exportCsv = async () => {
    // Web parity (AnalyticsSheet.handleExportCsv): transfer legs are
    // internal money moves, not income/expense — they are excluded, and
    // the amount is the raw t.amount (always positive); the sign
    // semantics live in the «Тип» column, same as the web file.
    const report = financeTransactionsToCsv(scopedTransactions, categories, {
      teamName: new Map(allTeams.map((team) => [team.id, team.name])),
      accounts,
    });
    if (report.count === 0) {
      toast("За выбранный период нет операций", "info");
      return;
    }
    try {
      await shareCsvFile({
        contents: report.contents,
        filename: `babun-finance-${period.from}-${period.to}.csv`,
        dialogTitle: `Финансы ${period.from} – ${period.to}`,
      });
      toast(`Отчёт подготовлен · ${report.count}`, "success");
    } catch (error) {
      Alert.alert(
        "Не удалось выгрузить отчёт",
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
    }
  };

  // Выгрузка запускается со страницы настроек, но живёт здесь: файл собирают
  // текущий период и текущий срез, а они у этого экрана.
  const exportNonce = params.exportReport;
  const lastExportRef = useRef<string | null>(null);
  useEffect(() => {
    if (!exportNonce || lastExportRef.current === exportNonce) return;
    lastExportRef.current = exportNonce;
    void exportCsv();
    // exportCsv пересоздаётся каждый рендер — гоняем строго по нонсу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportNonce]);

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
          borderRadius: 22,
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
            // Начали печатать — возвращаем ленту: в разрезах «Долги» и
            // «Прибыль» её на экране нет вовсе, и поиск фильтровал бы
            // невидимое.
            if (next.trim() && view !== "all" && view !== "income" && view !== "expense") {
              setView("all");
            }
          }}
          // Слова подсказки — ФИНАНСОВЫЕ: так человек и ищет операцию —
          // по сумме, по кассе, по своей же заметке. «Клиент» и «категория»
          // здесь не то, чем думают в этом разделе (владелец 2026-08-09),
          // хотя искать по ним поле по-прежнему умеет.
          placeholder="Сумма, счёт, заметка"
          accessibilityLabel="Поиск по операциям"
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
            borderRadius: 22,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <BarChart3 color={t.sub} size={21} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );

  const feedTitle =
    view === "income"
      ? `Доход · ${feedTx.length}`
      : view === "expense"
        ? `Расход · ${feedTx.length}`
        : `Операции · ${feedTx.length}`;

  if (loading) {
    return (
      <Screen>
        {header}
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen>
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
    <Screen>
      {header}

      <FinanceOverview
        teams={teams}
        scopeTeamId={scope}
        onScopeChange={setScope}
        period={period}
        onOpenPresets={() => setPresetOpen(true)}
        onOpenCustom={() => setWheelsOpen(true)}
        totals={totals}
        acctTotal={acctTotal}
        acctHasHidden={acctVisible.hasHidden}
        invoices={invoiceSummary}
        onOpenAccounts={() => pushOnce("/accounts")}
        onOpenDocuments={() => pushOnce("/documents")}
        view={view}
        onTap={toggleView}
      />

      {requestedClientId ? (
        <View
          className="mx-3 mb-2 flex-row items-center rounded-2xl px-4 py-3"
          style={{ backgroundColor: t.surface }}
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

      {view === "profit" ? (
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
          teamId={scope}
          fromDate={period.from}
          toDate={period.to}
          todayYmd={businessToday}
        />
      ) : (
        <TransactionsFeed
          transactions={feedTx}
          // Поиск ищет ВНУТРИ периода — лента грузится окном. Молчать об
          // этом значит выдать «ничего не найдено» за «такого не было».
          emptyTitle={
            query.trim()
              ? "В выбранном периоде ничего не найдено"
              : undefined
          }
          accounts={accounts}
          teams={allTeams}
          categories={categories}
          clients={clients}
          appointments={scopedAppointments}
          services={services}
          title={feedTitle}
          onReset={view !== "all" ? () => setView("all") : undefined}
          onTxTap={(tx) => {
            if (tx.type === "transfer") {
              confirmDeleteTransfer(tx);
              return;
            }
            // ТАП ОТКРЫВАЕТ ПРАВКУ, А НЕ ВИТРИНУ. Владелец 2026-08-10: «чтобы
            // не надо было по пять раз нажимать редактировать — сразу всё
            // открывается и правится». Витрина остаётся только для того, что
            // править нельзя: проводка из записи и операция с инвойсом
            // меняются в своём документе, иначе деньги разъедутся с ним.
            if (canEditTransaction(tx)) {
              setEditingTx(tx);
              setOpOpen(true);
              return;
            }
            setPopupTx(tx);
          }}
        />
      )}

      {/* Создание операции — понятная подписанная нижняя кнопка. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="Новая операция"
          onPress={() => {
            setEditingTx(null);
            setOpOpen(true);
          }}
        />
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
          await delTx.mutateAsync(tx.id);
        }}
        onRefund={handleRefund}
      />

      <OperationSheet
        visible={opOpen}
        // editingTx НЕ обнуляется здесь: шапка мигала «Операция»→«Новая
        // операция» пока лист уезжал; открывающие пути сами ставят нужное.
        onClose={() => setOpOpen(false)}
        defaultTeamId={scope}
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
          setTimeout(() => setPopupTx(tx), SHEET_EXIT_MS);
        }}
        refundedTotal={
          editingTx ? refundTotals?.get(editingTx.id) ?? 0 : 0
        }
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

export default function FinancesTab() {
  return (
    <RoleCapabilityBoundary capability="view-finances" title="Финансы">
      <FinancesContent />
    </RoleCapabilityBoundary>
  );
}
