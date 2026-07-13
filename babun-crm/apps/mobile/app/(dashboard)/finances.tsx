import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";
import { useRouter } from "expo-router";
import { Settings } from "lucide-react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { getDebtAmount } from "@babun/shared/local/appointments";
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
import { AccountsPanel } from "@/features/finances/AccountsPanel";
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
import { defaultPeriod, type Period } from "@/features/finances/period";

const TYPE_LABEL: Record<FinanceTransaction["type"], string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
  refund: "Возврат",
};

export default function FinancesTab() {
  const t = useThemeColors();
  const router = useRouter();

  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [view, setView] = useState<HomeView>("all");
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);

  const { data: categories = [] } = useFinanceCategories();
  const { data: teams = [] } = useTeams();
  const { data: services = [] } = useServices();
  const { data: appts = [] } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: accounts = [], isLoading: accountsLoading } =
    useAccountsWithBalances();
  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const insertTx = useInsertTransaction();

  // LOCKED «strict per-team»: no «Все» scope — default to the first team
  // as soon as the list arrives (web parity: FinancesPage scopeTeamId).
  useEffect(() => {
    if (scope === null && teams.length > 0) setScope(teams[0].id);
  }, [teams, scope]);

  const {
    data: txs = [],
    isLoading,
    error,
  } = useTransactions(period.from, period.to, scope ? [scope] : undefined);

  // Accounts are strictly per-team too (LOCKED: one account = one team).
  const scopedAccounts = useMemo(
    () => (scope ? accounts.filter((a) => a.brigade_id === scope) : accounts),
    [accounts, scope],
  );
  const acctTotal = useMemo(
    () => scopedAccounts.reduce((s, a) => s + a.balance, 0),
    [scopedAccounts],
  );

  // Web parity: computePeriodTotals (apps/web/src/lib/finance/ledger-compute.ts).
  // Refunds fold into income as negatives via signedAmount; transfers net to
  // zero across the pair and are ignored in P&L. Debt = completed-but-unpaid
  // appointments in the period for the selected brigade.
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of txs) {
      if (tx.type === "income" || tx.type === "refund")
        income += signedAmount(tx);
      else if (tx.type === "expense") expense += tx.amount;
    }
    // Debt via the shared getDebtAmount (prepaid + payments[]) — the web
    // payment_status/paid_amount fields are never mapped by the mobile
    // repository, so «total − paid_amount» would flag every completed
    // visit as fully unpaid (same helper as close-day / dashboard).
    let debt = 0;
    for (const a of appts) {
      if (a.status !== "completed") continue;
      if (a.date < period.from || a.date > period.to) continue;
      if (scope && a.team_id !== scope) continue;
      debt += getDebtAmount(a);
    }
    return { income, expense, profit: income - expense, debt };
  }, [txs, appts, period.from, period.to, scope]);

  // Σ refunds already issued against each income — caps further refunds.
  // NOT computed from the period-windowed txs: a refund is dated TODAY and
  // can land outside the viewed period (e.g. refunding a June income while
  // browsing «Прошлый месяц» on July 2) — the windowed sum would reset to 0
  // and let repeat refunds silently overdraw the ledger.
  const { data: refundTotals } = useRefundTotals();

  // Feed filtered by the active overview card (web parity: feedTx).
  const feedTx = useMemo(() => {
    if (view === "income")
      return txs.filter((tx) => tx.type === "income" || tx.type === "refund");
    if (view === "expense") return txs.filter((tx) => tx.type === "expense");
    return txs;
  }, [txs, view]);

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
                // orphan leg without a group id — remove the single row
                await delTx.mutateAsync(tx.id);
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
    await insertTx.mutateAsync({
      type: "refund",
      amount: -Math.abs(amount),
      account_id: tx.account_id,
      team_id: tx.team_id,
      category_id: tx.category_id,
      payment_method: tx.payment_method,
      refund_of_id: tx.id,
      notes: `Возврат по операции от ${tx.occurred_on}`,
    });
  };

  const openFinanceSettings = () => {
    Alert.alert("Настройки финансов", undefined, [
      {
        text: "Категории операций",
        onPress: () => router.push("/cabinet/categories"),
      },
      {
        text: "Шаблоны операций",
        onPress: () => router.push("/cabinet/templates"),
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
    const exportable = txs.filter((tx) => tx.type !== "transfer");
    if (exportable.length === 0) return;
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const header = "Дата;Тип;Категория;Сумма;Заметка";
    const rows = exportable.map((tx) =>
      [
        tx.occurred_on,
        TYPE_LABEL[tx.type],
        tx.category_id ? catName.get(tx.category_id) ?? "" : "",
        String(tx.amount),
        (tx.notes ?? "").replace(/[;\n\r]/g, " "),
      ].join(";"),
    );
    await Share.share({
      message: [header, ...rows].join("\n"),
      title: `Финансы ${period.from} – ${period.to}`,
    });
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
        view={view}
        onTap={toggleView}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : view === "accounts" ? (
        <AccountsPanel accounts={scopedAccounts} isLoading={accountsLoading} />
      ) : view === "profit" ? (
        <ProfitBreakdown
          transactions={txs}
          categories={categories}
          services={services}
          appointments={appts}
        />
      ) : view === "debt" ? (
        <DebtorsList
          appointments={appts}
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
          appointments={appts}
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
          onClientTap={(id) => router.push(`/clients/${id}`)}
        />
      )}

      {/* Создание операции — нижняя градиентная кнопка (веб-паритет:
          apps/web finances «＋ Операция» sticky-футер). Заменила прежний FAB
          после удаления Fab-примитива; лежит под контентом (фид flex:1). */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton
          label="＋ Операция"
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
        transaction={editingTx}
      />

      <PeriodPresetModal
        visible={presetOpen}
        current={period}
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
