import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  SectionList,
  Share,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ChevronDown, ChevronRight, Plus, Share2, Wallet } from "lucide-react-native";
import {
  formatEUR,
  formatEURSigned,
} from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { useTeams } from "@/features/reference/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useTransactions,
} from "@/features/finances/queries";
import { OperationSheet } from "@/features/finances/OperationSheet";
import { ProfitBreakdown } from "@/features/finances/ProfitBreakdown";
import { DebtorsList } from "@/features/finances/DebtorsList";
import { PeriodModal } from "@/features/finances/PeriodModal";
import {
  useAccountsWithBalances,
  useDeleteTransfer,
} from "@/features/finances/accounts";
import {
  defaultPeriod,
  periodLabel,
  type Period,
} from "@/features/finances/period";

const TYPE_LABEL: Record<FinanceTransaction["type"], string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
  refund: "Возврат",
};

// Which panel the overview cards select below (web parity: HomeView in
// FinanceOverview.tsx; «Счета» routes to the accounts screen instead).
type HomeView = "all" | "income" | "expense" | "debt" | "profit";

function MetricCard({
  label,
  value,
  color,
  active,
  onPress,
  negative,
}: {
  label: string;
  value: number;
  color: string;
  active: boolean;
  onPress: () => void;
  negative?: boolean;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-xl px-3.5 py-2.5 active:opacity-70"
      style={{
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: active ? color : "transparent",
      }}
    >
      <View className="mb-1 flex-row items-center gap-1.5">
        <View
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <Text className="text-xs font-semibold" style={{ color: t.sub }}>
          {label}
        </Text>
      </View>
      <Text className="text-[22px] font-bold tabular-nums" style={{ color }}>
        {negative && value > 0 ? "−" : ""}
        {formatEUR(value)}
      </Text>
    </Pressable>
  );
}

function TxRow({ tx, onPress }: { tx: FinanceTransaction; onPress: () => void }) {
  const t = useThemeColors();
  const signed = signedAmount(tx);
  // Web parity: transfer legs render neutral (grey), not green/red.
  const amountColor =
    tx.type === "transfer" ? t.sub : signed >= 0 ? t.success : t.danger;
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:opacity-60"
      style={{ backgroundColor: t.surface }}
    >
      <View className="flex-1 pr-3">
        <Text className="text-base" style={{ color: t.ink }} numberOfLines={1}>
          {tx.notes || TYPE_LABEL[tx.type]}
        </Text>
        <Text className="text-xs" style={{ color: t.faint }}>
          {TYPE_LABEL[tx.type]}
        </Text>
      </View>
      <Text
        className="text-base font-semibold tabular-nums"
        style={{ color: amountColor }}
      >
        {formatEURSigned(signed)}
      </Text>
    </Pressable>
  );
}

export default function FinancesTab() {
  const t = useThemeColors();
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [scope, setScope] = useState<string | null>(null);
  const [opOpen, setOpOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [view, setView] = useState<HomeView>("all");
  const { data: categories = [] } = useFinanceCategories();
  const [periodOpen, setPeriodOpen] = useState(false);

  const router = useRouter();
  const { data: teams = [] } = useTeams();
  const { data: appts = [] } = useAppointments();
  const { data: clients = [] } = useClients();
  const { data: accounts = [] } = useAccountsWithBalances();
  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const accountsTotal = useMemo(
    () => accounts.reduce((s, a) => s + a.balance, 0),
    [accounts],
  );
  const {
    data: txs = [],
    isLoading,
    error,
  } = useTransactions(period.from, period.to, scope ? [scope] : undefined);

  // Web parity: computePeriodTotals (apps/web/src/lib/finance/ledger-compute.ts).
  // Refunds fold into income as negatives via signedAmount; transfers net to
  // zero across the pair and are ignored in P&L. Debt = completed-but-unpaid
  // appointments in the period for the selected brigade.
  const { income, expense, profit, debt } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (t.type === "income" || t.type === "refund") income += signedAmount(t);
      else if (t.type === "expense") expense += t.amount;
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

  // Feed filtered by the active overview card (web parity: feedTx).
  const feedTx = useMemo(() => {
    if (view === "income")
      return txs.filter((t) => t.type === "income" || t.type === "refund");
    if (view === "expense") return txs.filter((t) => t.type === "expense");
    return txs;
  }, [txs, view]);

  const sections = useMemo(() => {
    const byDate = new Map<string, FinanceTransaction[]>();
    for (const t of feedTx) {
      const arr = byDate.get(t.occurred_on) ?? [];
      arr.push(t);
      byDate.set(t.occurred_on, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({
        title: date,
        net: data.reduce((s, t) => s + signedAmount(t), 0),
        data,
      }));
  }, [feedTx]);

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

  const controls = (
    <View>
      {/* period selector */}
      <Pressable
        onPress={() => setPeriodOpen(true)}
        className="mx-4 mb-1 mt-1 flex-row items-center self-start rounded-full px-3 py-1.5 active:opacity-80"
        style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
      >
        <Text className="text-sm font-semibold" style={{ color: t.ink }}>
          {periodLabel(period)}
        </Text>
        <ChevronDown color={t.sub} size={16} />
      </Pressable>

      {/* team scope */}
      {teams.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, maxHeight: 48 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}
        >
          {[{ id: null as string | null, name: "Все" }, ...teams].map((team) => {
            const active = scope === team.id;
            return (
              <Pressable
                key={team.id ?? "all"}
                onPress={() => setScope(team.id)}
                className="rounded-full px-3.5 py-1.5"
                style={{
                  backgroundColor: active
                    ? t.accent
                    : t.dark
                      ? "rgba(255,255,255,0.07)"
                      : "#eef1f5",
                }}
              >
                <Text
                  className="text-sm font-medium"
                  style={{ color: active ? t.onAccent : t.sub }}
                >
                  {team.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  // Locked v5 overview (web FinanceOverview.tsx): «Счета» mini-card, two
  // Доход/Расход metric cards, «Долги | Прибыль» row. Cards toggle the
  // panel below; прибыль is always brandAccent (#34AADC) on its own tint.
  const overview = (
    <View className="px-4 pb-2 pt-1" style={{ gap: 8 }}>
      <Pressable
        onPress={() => router.push("/cabinet/accounts")}
        className="flex-row items-center rounded-xl px-3.5 py-2.5 active:opacity-70"
        style={{ backgroundColor: t.surface }}
      >
        <Wallet color={t.sub} size={16} />
        <Text className="ml-2.5 text-sm font-semibold" style={{ color: t.sub }}>
          Счета
        </Text>
        <View className="ml-auto flex-row items-center gap-1">
          <Text
            className="text-[15px] font-semibold tabular-nums"
            style={{ color: t.ink }}
          >
            {formatEUR(accountsTotal)}
          </Text>
          <ChevronRight color={t.chevron} size={16} />
        </View>
      </Pressable>

      <View className="flex-row" style={{ gap: 8 }}>
        <MetricCard
          label="Доход"
          value={income}
          color={t.success}
          active={view === "income"}
          onPress={() => toggleView("income")}
        />
        <MetricCard
          label="Расход"
          value={expense}
          color={t.danger}
          active={view === "expense"}
          onPress={() => toggleView("expense")}
          negative
        />
      </View>

      <View className="flex-row" style={{ gap: 8 }}>
        <Pressable
          onPress={() => toggleView("debt")}
          className="flex-1 flex-row items-center rounded-xl px-3.5 py-2.5 active:opacity-70"
          style={{
            backgroundColor: t.surface,
            borderWidth: 1.5,
            borderColor: view === "debt" ? t.warning : "transparent",
          }}
        >
          <View
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: t.warning }}
          />
          <Text className="ml-2 text-sm font-semibold" style={{ color: t.sub }}>
            Долги
          </Text>
          <Text
            className="ml-auto text-[15px] font-bold tabular-nums"
            style={{ color: t.warning }}
          >
            {formatEUR(debt)}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => toggleView("profit")}
          className="flex-1 flex-row items-center rounded-xl px-3.5 py-2.5 active:opacity-70"
          style={{
            backgroundColor:
              view === "profit" ? "rgba(52,170,220,0.16)" : "rgba(52,170,220,0.07)",
            borderWidth: 1.5,
            borderColor: view === "profit" ? t.brandAccent : "transparent",
          }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.brandAccent }}>
            Прибыль
          </Text>
          <View className="ml-auto flex-row items-center gap-1">
            <Text
              className="text-[15px] font-bold tabular-nums"
              style={{ color: t.brandAccent }}
            >
              {profit >= 0 ? "+" : "−"}
              {formatEUR(Math.abs(profit))}
            </Text>
            <ChevronRight color={t.brandAccent} size={16} />
          </View>
        </Pressable>
      </View>
    </View>
  );

  const exportCsv = async () => {
    // Web parity (AnalyticsSheet.handleExportCsv): transfer legs are
    // internal money moves, not income/expense — they are excluded, and
    // the amount is the raw t.amount (always positive); the sign
    // semantics live in the «Тип» column, same as the web file.
    const exportable = txs.filter((t) => t.type !== "transfer");
    if (exportable.length === 0) return;
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const header = "Дата;Тип;Категория;Сумма;Заметка";
    const rows = exportable.map((t) =>
      [
        t.occurred_on,
        TYPE_LABEL[t.type],
        t.category_id ? catName.get(t.category_id) ?? "" : "",
        String(t.amount),
        (t.notes ?? "").replace(/[;\n\r]/g, " "),
      ].join(";"),
    );
    await Share.share({
      message: [header, ...rows].join("\n"),
      title: `Финансы ${period.from} – ${period.to}`,
    });
  };

  const headerRight = (
    <Pressable
      onPress={exportCsv}
      hitSlop={8}
      className="h-9 w-9 items-center justify-center rounded-full active:opacity-60"
    >
      <Share2 color={t.body} size={18} />
    </Pressable>
  );

  return (
    <Screen>
      <ScreenHeader large title="Финансы" right={headerRight} />
      {controls}
      {overview}

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState state="error" fill subtitle={(error as Error).message} />
      ) : view === "profit" ? (
        <ProfitBreakdown transactions={txs} categories={categories} />
      ) : view === "debt" ? (
        <DebtorsList
          appointments={appts}
          clients={clients}
          teamId={scope}
          fromDate={period.from}
          toDate={period.to}
        />
      ) : (
        <SectionList
          style={{ flex: 1 }}
          sections={sections}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={
            <Text
              className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: t.sub }}
            >
              Операции · {feedTx.length}
            </Text>
          }
          contentContainerStyle={{ paddingBottom: 96 }}
          renderSectionHeader={({ section }) => (
            <View
              className="flex-row items-center justify-between px-4 py-1.5"
              style={{ backgroundColor: t.canvas }}
            >
              <Text
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: t.sub }}
              >
                {humanDay(section.title)}
              </Text>
              <Text
                className="text-xs font-semibold tabular-nums"
                style={{ color: t.sub }}
              >
                {formatEURSigned(section.net)}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TxRow
              tx={item}
              onPress={() => {
                if (item.type === "transfer") {
                  confirmDeleteTransfer(item);
                  return;
                }
                setEditingTx(item);
                setOpOpen(true);
              }}
            />
          )}
          ItemSeparatorComponent={() => (
            <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
          )}
          ListEmptyComponent={
            <EmptyState
              title="Нет операций за период"
              subtitle="Нажмите + чтобы добавить"
            />
          }
        />
      )}

      <Pressable
        onPress={() => {
          setEditingTx(null);
          setOpOpen(true);
        }}
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full active:opacity-90"
        style={{
          backgroundColor: t.accent,
          shadowColor: t.accent,
          shadowOpacity: 0.3,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Plus color={t.onAccent} size={28} />
      </Pressable>

      <OperationSheet
        visible={opOpen}
        onClose={() => {
          setOpOpen(false);
          setEditingTx(null);
        }}
        defaultTeamId={scope}
        transaction={editingTx}
      />
      <PeriodModal
        visible={periodOpen}
        current={period}
        onClose={() => setPeriodOpen(false)}
        onApply={setPeriod}
      />
    </Screen>
  );
}
