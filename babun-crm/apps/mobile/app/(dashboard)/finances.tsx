import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Settings, X } from "lucide-react-native";
import { signedAmount, type FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import { appointmentMaterialCost } from "@babun/shared/local/finance/appointment-calc";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
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
  const params = useLocalSearchParams<{ clientId?: string | string[] }>();
  const requestedClientId = Array.isArray(params.clientId)
    ? params.clientId[0]
    : params.clientId;
  const { openInvoices, openTransactionInvoice } = useInvoiceNavigation();
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
  // баланс общего умножался бы на число команд при переключении чипов);
  // скрытые балансы в сумму не входят — маркер EyeOff говорит о неполноте.
  const miniCardAccounts = useMemo(
    () =>
      scope ? scopedAccounts.filter((a) => a.scope === "team") : scopedAccounts,
    [scope, scopedAccounts],
  );
  // Владелец 2026-07-27: маркер-глазик у плитки снят — Σ считается по
  // ВСЕМ счетам скоупа (скрытие остатка живёт в списках и на счёте).
  const acctTotal = useMemo(
    () => miniCardAccounts.reduce((s, a) => s + a.balance, 0),
    [miniCardAccounts],
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
      if (a.status !== "completed") continue;
      if (a.date < period.from || a.date > period.to) continue;
      if (scope && a.team_id !== scope) continue;
      debt += getDebtAmount(a);
    }
    const expenseWithMaterials = expense + materialSummary.amount;
    return {
      income,
      expense: expenseWithMaterials,
      profit: income - expenseWithMaterials,
      debt,
    };
  }, [
    scopedTransactions,
    scopedAppointments,
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
  const loading =
    transactionsQuery.isLoading ||
    categoriesQuery.isLoading ||
    teamsQuery.isLoading ||
    servicesQuery.isLoading ||
    appointmentsQuery.isLoading ||
    clientsQuery.isLoading ||
    invoicesQuery.isLoading ||
    invoicePaymentsQuery.isLoading ||
    accountsQuery.isLoading ||
    refundTotalsQuery.isLoading ||
    calendarSettingsQuery.isLoading;
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
  }, [businessToday, invoicePayments, scopedInvoices]);

  // Feed filtered by the active overview card (web parity: feedTx).
  const feedTx = useMemo(() => {
    if (view === "income")
      return scopedTransactions.filter(
        (tx) => tx.type === "income" || tx.type === "refund",
      );
    if (view === "expense")
      return scopedTransactions.filter((tx) => tx.type === "expense");
    return scopedTransactions;
  }, [scopedTransactions, view]);

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

  const openFinanceSettings = () => {
    Alert.alert("Настройки финансов", undefined, [
      {
        text: "Счета",
        onPress: () => router.push("/accounts"),
      },
      {
        text: "Категории операций",
        onPress: () => router.push("/cabinet/categories"),
      },
      {
        text: "Шаблоны операций",
        onPress: () => router.push("/cabinet/templates"),
      },
      {
        text: "Инвойсы",
        onPress: openInvoices,
      },
      // Экспорт переехал сюда из шапки: иконка без подписи не читалась.
      // Подпись явно называет и действие, и его границы (текущий период).
      { text: "Экспорт отчёта за период", onPress: () => exportCsv() },
      { text: "Отмена", style: "cancel" },
    ]);
  };

  const exportCsv = async () => {
    // Web parity (AnalyticsSheet.handleExportCsv): transfer legs are
    // internal money moves, not income/expense — they are excluded, and
    // the amount is the raw t.amount (always positive); the sign
    // semantics live in the «Тип» column, same as the web file.
    const report = financeTransactionsToCsv(scopedTransactions, categories, {
      teamName: new Map(teams.map((team) => [team.id, team.name])),
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

  const headerRight = (
    <Pressable
      onPress={openFinanceSettings}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Настройки финансов"
      className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
    >
      <Settings color={t.body} size={18} />
    </Pressable>
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
        <ScreenHeader large title="Финансы" right={headerRight} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen>
        <ScreenHeader large title="Финансы" right={headerRight} />
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
      <ScreenHeader large title="Финансы" right={headerRight} />

      <FinanceOverview
        teams={teams}
        scopeTeamId={scope}
        onScopeChange={setScope}
        period={period}
        onOpenPresets={() => setPresetOpen(true)}
        onOpenCustom={() => setWheelsOpen(true)}
        totals={totals}
        acctTotal={acctTotal}
        invoices={invoiceSummary}
        onOpenAccounts={() => router.push("/accounts")}
        onOpenDocuments={() => router.push("/documents")}
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
        />
      ) : (
        <TransactionsFeed
          transactions={feedTx}
          accounts={accounts}
          teams={teams}
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
        teams={teams}
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
        onEdit={(tx) => {
          setPopupTx(null);
          setEditingTx(tx);
          setOpOpen(true);
        }}
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
        onClose={() => {
          setOpOpen(false);
          setEditingTx(null);
        }}
        defaultTeamId={scope}
        businessToday={businessToday}
        transaction={editingTx}
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
