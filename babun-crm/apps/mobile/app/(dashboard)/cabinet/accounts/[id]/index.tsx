import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Eye, EyeOff, Settings } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { todayYmd } from "@/features/invoices/format";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NavRow } from "@/components/ui/card-rows";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useServices } from "@/features/services/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useInvoiceNavigation } from "@/features/invoices/navigation";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import {
  useAccountsWithBalances,
  useDeleteTransfer,
  useUpdateAccount,
} from "@/features/finances/accounts";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useRefundTotals,
  useTransactions,
} from "@/features/finances/queries";
import { HIDDEN_BALANCE_LABEL, KIND_ICON, KINDS } from "@/features/finances/account-ui";
import {
  breakdownAccountInflowByTeam,
} from "@/features/finances/account-inflow";
import { AccountTeamInflow } from "@/features/finances/AccountTeamInflow";
import {
  MonthStepper,
  monthOfYmd,
  monthRange,
  type MonthValue,
} from "@/features/finances/MonthStepper";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { TransactionsFeed } from "@/features/finances/TransactionsFeed";
import { TransactionPopup } from "@/features/finances/TransactionPopup";
import { OperationSheet } from "@/features/finances/OperationSheet";

function AccountDetailContent() {
  const t = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const account = accounts.find((a) => a.id === id) ?? null;
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );

  const allTeamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => allTeamsQuery.data ?? [], [allTeamsQuery.data]);
  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );

  // Бизнес-месяц тенанта — правая граница степпера.
  const calendarSettings = useCalendarSettings().data;
  const businessToday = todayYmd(calendarSettings?.timezone ?? "Europe/Nicosia");
  const currentMonth = monthOfYmd(businessToday);
  const [month, setMonth] = useState<MonthValue>(currentMonth);
  const { from, to } = monthRange(month);

  // ПОЛНЫЙ месячный срез (все счета): инкассации атрибуцируются по ноге
  // счёта-источника — из среза одного счёта пару не увидеть. Ключ ложится
  // под существующий префикс ["transactions"] — инвалидация леджера
  // покрывает страницу бесплатно.
  const txsQuery = useTransactions(from, to);
  const txs = useMemo(() => txsQuery.data ?? [], [txsQuery.data]);
  const accountTxs = useMemo(
    () => txs.filter((tx) => tx.account_id === id),
    [txs, id],
  );
  const breakdown = useMemo(
    () => breakdownAccountInflowByTeam(id as string, txs, accounts),
    [id, txs, accounts],
  );

  const categories = useFinanceCategories().data ?? [];
  const services = useServices().data ?? [];
  const appointments = useAppointments().data ?? [];
  const clients = useClients().data ?? [];
  const refundTotals = useRefundTotals().data;
  const { openTransactionInvoice } = useInvoiceNavigation();

  const updateAcc = useUpdateAccount();
  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const insertTx = useInsertTransaction();

  // Глазик: скрытие — постоянное (синкается), показ по тапу — временный,
  // до ухода со страницы.
  const [tempRevealed, setTempRevealed] = useState(false);
  useEffect(() => {
    setTempRevealed(false);
  }, [id]);
  const hidden = !!account?.balance_hidden && !tempRevealed;

  const [transferOpen, setTransferOpen] = useState(false);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [opOpen, setOpOpen] = useState(false);

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

  // Web handleRefund parity — как на странице «Финансы».
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

  const toggleEye = () => {
    if (!account) return;
    haptics.tap();
    if (!account.balance_hidden) {
      updateAcc.mutate(
        { id: account.id, patch: { balance_hidden: true } },
        { onError: (e) => Alert.alert("Ошибка", e.message) },
      );
      setTempRevealed(false);
    } else {
      setTempRevealed((v) => !v);
    }
  };

  if (accountsQuery.isLoading || allTeamsQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счёт" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (!account) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счёт" />
        <EmptyState
          fill
          title="Счёт не найден"
          subtitle="Возможно, он был удалён"
          action={{ label: "К списку счетов", onPress: () => router.replace("/cabinet/accounts") }}
        />
      </Screen>
    );
  }

  const Icon = KIND_ICON[account.kind];
  const kindLabel = KINDS.find((k) => k.value === account.kind)?.label ?? "";
  const subtitle =
    account.scope === "company"
      ? `${kindLabel} · Общий, ${account.team_ids.length} ${
          account.team_ids.length === 1 ? "команда" : account.team_ids.length < 5 ? "команды" : "команд"
        }`
      : `${kindLabel} · ${
          (account.brigade_id && teamById.get(account.brigade_id)?.name) || "Без бригады"
        }`;
  const memberTeams = account.team_ids
    .map((teamId) => teamById.get(teamId))
    .filter((team): team is NonNullable<typeof team> => !!team);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={account.name}
        right={
          <Pressable
            onPress={() => router.push(`/cabinet/accounts/${account.id}/settings`)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Настройки счёта"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
          >
            <Settings color={t.body} size={18} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero: вид · принадлежность, баланс, глазик. */}
        <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 16 }}>
          <View className="flex-row items-center gap-3">
            <View
              className="items-center justify-center rounded-lg"
              style={{ width: 32, height: 32, backgroundColor: t.highlight }}
            >
              <Icon color={t.accent} size={ICON.sm} />
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[13px] font-medium" style={{ color: t.sub }} numberOfLines={1}>
                  {subtitle}
                </Text>
                {memberTeams.length > 0 ? (
                  <View className="flex-row items-center gap-1">
                    {memberTeams.map((team) => (
                      <View
                        key={team.id}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: team.color || t.accent,
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
              {!account.is_active ? (
                <Text className="mt-0.5 text-xs font-semibold" style={{ color: t.warning }}>
                  Счёт закрыт
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={toggleEye}
              accessibilityRole="button"
              accessibilityLabel={
                account.balance_hidden
                  ? tempRevealed
                    ? "Скрыть баланс"
                    : "Показать баланс"
                  : "Скрывать баланс"
              }
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              {hidden ? (
                <EyeOff color={t.sub} size={22} />
              ) : (
                <Eye color={t.sub} size={22} />
              )}
            </Pressable>
          </View>
          <Text
            className="mt-2 tabular-nums"
            style={{ fontSize: 34, fontWeight: "800", color: t.ink }}
          >
            {hidden ? HIDDEN_BALANCE_LABEL : formatEUR(account.balance)}
          </Text>
        </Card>

        {account.is_active ? (
          <Card style={{ marginHorizontal: 12, marginTop: 12 }}>
            <NavRow
              label="Перевод"
              placeholder="Между счетами"
              onPress={() => setTransferOpen(true)}
            />
          </Card>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <MonthStepper value={month} max={currentMonth} onChange={setMonth} />
        </View>

        {account.scope === "company" ? (
          txsQuery.isLoading ? null : (
            <AccountTeamInflow
              account={account}
              breakdown={breakdown}
              teamById={teamById}
            />
          )
        ) : null}

        <View style={{ marginTop: 8 }}>
          {txsQuery.isLoading ? (
            <EmptyState state="loading" />
          ) : (
            <TransactionsFeed
              transactions={accountTxs}
              accounts={accounts}
              teams={teams}
              categories={categories}
              clients={clients}
              appointments={appointments}
              services={services}
              title={`Операции · ${accountTxs.length}`}
              contextMode="team"
              scroll={false}
              onTxTap={(tx) => {
                if (tx.type === "transfer") {
                  confirmDeleteTransfer(tx);
                  return;
                }
                setPopupTx(tx);
              }}
            />
          )}
        </View>
      </ScrollView>

      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={activeAccounts}
        teamById={teamById}
        presetFromId={account.id}
      />

      <TransactionPopup
        visible={!!popupTx}
        transaction={popupTx}
        accounts={accounts}
        teams={teams}
        categories={categories}
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
        defaultTeamId={account.scope === "team" ? account.brigade_id : null}
        businessToday={businessToday}
        transaction={editingTx}
      />
    </Screen>
  );
}

export default function AccountDetailScreen() {
  return (
    <RoleCapabilityBoundary capability="view-finances" title="Счёт">
      <AccountDetailContent />
    </RoleCapabilityBoundary>
  );
}
