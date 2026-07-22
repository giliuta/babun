import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import {
  accountDisplayName,
  type AccountKind,
} from "@babun/shared/local/finance/account";
import { transferValidationError } from "@babun/shared/local/finance/integrity";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import {
  useAccountsWithBalances,
  useCreateTransfer,
  useInsertAccount,
  useSoftCloseAccount,
  useUpdateAccount,
  type AccountWithBalance,
} from "@/features/finances/accounts";

const KIND_ICON: Record<AccountKind, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  bank: Landmark,
  other: Wallet,
};
const KINDS: { value: AccountKind; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "bank", label: "Банк" },
  { value: "other", label: "Другое" },
];

export default function AccountsScreen() {
  const th = useThemeColors();
  const accountsQuery = useAccountsWithBalances();
  // Активные — для чипов «Бригада» в форме создания; ВСЕ (вкл. soft-deleted)
  // — для резолва подзаголовков: счёт живёт дольше своей команды, и его
  // имя обязано резолвиться, иначе две «Налички» неразличимы.
  const teamsQuery = useTeams();
  const allTeamsQuery = useTeams({ includeInactive: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const allTeams = useMemo(
    () => allTeamsQuery.data ?? [],
    [allTeamsQuery.data],
  );
  const insert = useInsertAccount();
  const updateAcc = useUpdateAccount();
  const closeAcc = useSoftCloseAccount();
  const transfer = useCreateTransfer();

  const teamById = useMemo(
    () => new Map(allTeams.map((t) => [t.id, t])),
    [allTeams],
  );
  const total = useMemo(
    () => accounts.reduce((s, a) => s + a.balance, 0),
    [accounts],
  );
  const hasTransferPair = useMemo(
    () =>
      accounts.some((account, index) =>
        accounts.slice(index + 1).some(
          (candidate) => candidate.brigade_id === account.brigade_id,
        ),
      ),
    [accounts],
  );

  const [open, setOpen] = useState(false);
  // Правка счёта (имя/тип/бригада) — раньше опечатку можно было исправить
  // только «закрыть и создать заново» (аудит P1-9). Начальный баланс после
  // создания не редактируем: баланс = opening + леджер, задним числом его
  // меняет только корректирующая операция.
  const [editingAcc, setEditingAcc] = useState<AccountWithBalance | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("cash");
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");

  // Умный дефолт: одна команда — значит счёт её; выбирать нечего.
  const openCreate = (presetBrigadeId?: string) => {
    setEditingAcc(null);
    setBrigadeId(
      presetBrigadeId ?? (teams.length === 1 ? teams[0].id : null),
    );
    setOpen(true);
  };
  const openEdit = (a: AccountWithBalance) => {
    setEditingAcc(a);
    setName(a.name);
    setKind(a.kind);
    setBrigadeId(a.brigade_id);
    setOpening("");
    setOpen(true);
  };

  // Цепочка из «Команды»: teams.tsx после создания команды шлёт
  // ?create=1&brigadeId=… — открываем шит с предвыбранной бригадой и
  // дефолтным именем «Касса»: до готового счёта остаётся один тап.
  const router = useRouter();
  const params = useLocalSearchParams<{ create?: string; brigadeId?: string }>();
  useEffect(() => {
    if (params.create === "1") {
      setName((n) => n || "Касса");
      openCreate(params.brigadeId || undefined);
      router.setParams({ create: undefined, brigadeId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.create, params.brigadeId]);

  const [tOpen, setTOpen] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [tAmount, setTAmount] = useState("");
  const [transferRequestId, setTransferRequestId] = useState(randomUuid);

  const transferAmountCents = parseMoneyInputToCents(tAmount);
  const tNum = (transferAmountCents ?? 0) / 100;
  const fromAccount = accounts.find((a) => a.id === fromId);
  const toAccount = accounts.find((a) => a.id === toId);
  const transferError =
    transferAmountCents == null
      ? "Введите сумму больше нуля и не больше двух знаков после запятой"
      : transferValidationError(fromAccount, toAccount, tNum);
  const canTransfer = transferError === null && !transfer.isPending;

  const doTransfer = async () => {
    if (!fromId || !toId || transferError) {
      Alert.alert("Перевод не выполнен", transferError ?? "Проверьте счета и сумму");
      return;
    }
    try {
      await transfer.mutateAsync({
        request_id: transferRequestId,
        from_account_id: fromId,
        to_account_id: toId,
        amount: tNum,
        brigade_id: fromAccount?.brigade_id ?? null,
      });
      setFromId(null);
      setToId(null);
      setTAmount("");
      setTransferRequestId(randomUuid());
      setTOpen(false);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const reset = () => {
    setEditingAcc(null);
    setName("");
    setKind("cash");
    setBrigadeId(null);
    setOpening("");
  };
  // Закрытие без сохранения (scrim/back) должно сбросить пресеты, иначе
  // предзаполненное из цепочки «команда→счёт» имя «Касса» доедет до
  // следующего ручного открытия через AddRow.
  const closeCreate = () => {
    setOpen(false);
    reset();
  };
  const openingCents = opening.trim()
    ? parseMoneyInputToCents(opening, {
        allowNegative: true,
        allowZero: true,
      })
    : 0;
  const canSave =
    !!name.trim() &&
    !!brigadeId &&
    openingCents != null &&
    !insert.isPending &&
    !updateAcc.isPending;

  const submitAccount = async () => {
    if (!brigadeId) return;
    if (openingCents == null) {
      Alert.alert(
        "Проверьте баланс",
        "Введите сумму и не больше двух знаков после запятой.",
      );
      return;
    }
    try {
      if (editingAcc) {
        await updateAcc.mutateAsync({
          id: editingAcc.id,
          patch: { name: name.trim(), kind, brigade_id: brigadeId },
        });
      } else {
        await insert.mutateAsync({
          name: name.trim(),
          kind,
          brigade_id: brigadeId,
          opening_balance: openingCents / 100,
        });
      }
      reset();
      setOpen(false);
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const confirmClose = (a: AccountWithBalance) => {
    if (Math.abs(a.balance) >= 0.005) {
      Alert.alert(
        "Сначала обнулите счёт",
        `${a.name}: остаток ${formatEUR(a.balance)}. Счёт с ненулевым балансом нельзя закрыть — история и общий остаток должны сходиться.`,
        [
          { text: "Понятно", style: "cancel" },
          ...(a.balance > 0 &&
          accounts.some(
            (item) => item.id !== a.id && item.brigade_id === a.brigade_id,
          )
            ? [
                {
                  text: "Перевести остаток",
                  onPress: () => {
                    setFromId(a.id);
                    setToId(null);
                    setTAmount(String(Math.round(a.balance * 100) / 100));
                    setTransferRequestId(randomUuid());
                    setTOpen(true);
                  },
                },
              ]
            : []),
        ],
      );
      return;
    }

    Alert.alert("Закрыть счёт?", `${a.name} — история сохранится`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Закрыть",
        style: "destructive",
        onPress: () =>
          closeAcc.mutate(a.id, {
            onError: (e) => Alert.alert("Ошибка", e.message),
          }),
      },
    ]);
  };

  const loading =
    accountsQuery.isLoading || teamsQuery.isLoading || allTeamsQuery.isLoading;
  const loadError =
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (allTeamsQuery.data === undefined ? allTeamsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      accountsQuery.refetch(),
      teamsQuery.refetch(),
      allTeamsQuery.refetch(),
    ]);

  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счета" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счета" />
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Счета"
        right={
          hasTransferPair ? (
            <Pressable
              onPress={() => {
                setTransferRequestId(randomUuid());
                setTOpen(true);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Перевод между счетами"
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
            >
              <ArrowLeftRight color={th.body} size={ICON.sm} />
            </Pressable>
          ) : undefined
        }
      />

      <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 16 }}>
        <Text className="text-xs" style={{ color: th.sub }}>Всего на счетах</Text>
        <Text
          className="mt-0.5 text-2xl font-bold"
          style={{ color: th.brandAccent }}
        >
          {formatEUR(total)}
        </Text>
      </Card>

      <FlatList
          style={{ flex: 1 }}
          data={accounts}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 104 }}
          renderItem={({ item }) => {
            const Icon = KIND_ICON[item.kind];
            // Счета строго per-brigade: подзаголовок = имя команды (это
            // единственное, что различает две «Налички»). Никаких «—»-
            // плейсхолдеров; оборванная ссылка читается как «Без бригады».
            const team = teamById.get(item.brigade_id);
            const teamLabel = team?.name ?? "Без бригады";
            return (
              <Pressable
                // Тап = открыть редактор (имя/тип/бригада + «Закрыть счёт»
                // внутри); long-press остаётся быстрым закрытием, зеркален
                // accessibility-экшеном для VoiceOver.
                onPress={() => openEdit(item)}
                onLongPress={() => confirmClose(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${teamLabel}, ${formatEUR(item.balance)}`}
                accessibilityHint="Открывает редактор счёта; долгое нажатие закрывает счёт"
                accessibilityActions={[
                  { name: "close-account", label: "Закрыть счёт" },
                ]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === "close-account")
                    confirmClose(item);
                }}
                className="flex-row items-center px-4 py-3 active:opacity-60"
              >
                <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: th.highlight }}>
                  <Icon color={th.accent} size={ICON.sm} />
                </View>
                <View className="flex-1 pr-2">
                  <Text className="text-base font-semibold" style={{ color: th.ink }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-1.5">
                    {team?.color ? (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: team.color,
                        }}
                      />
                    ) : null}
                    <Text
                      className="text-xs"
                      style={{ color: th.sub }}
                      numberOfLines={1}
                    >
                      {teamLabel}
                    </Text>
                  </View>
                </View>
                <Text className="text-base font-bold tabular-nums" style={{ color: th.ink }}>
                  {formatEUR(item.balance)}
                </Text>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListFooterComponent={
            accounts.length > 0 ? (
              <>
                <Divider inset={64} />
                <AddRow label="Добавить счёт" onPress={() => openCreate()} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет счетов"
              subtitle="Касса или карта бригады — деньги операций живут на счетах"
              action={{ label: "Добавить счёт", onPress: () => openCreate() }}
            />
          }
      />

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeCreate}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={closeCreate} accessible={false} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            {editingAcc ? "Счёт" : "Новый счёт"}
          </Text>
          <Field
            label="Название"
            value={name}
            onChangeText={setName}
            placeholder="Напр. Касса"
            autoFocus
          />
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Тип</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip
                key={k.value}
                label={k.label}
                radio
                selected={kind === k.value}
                onPress={() => setKind(k.value)}
              />
            ))}
          </View>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Бригада</Text>
          {teams.length === 0 ? (
            <Text className="mb-3 text-sm" style={{ color: th.faint }}>
              Сначала добавьте команду в справочниках.
            </Text>
          ) : (
            <View className="mb-3 flex-row flex-wrap gap-2">
              {teams.map((t) => (
                <Chip
                  key={t.id}
                  label={t.name}
                  radio
                  selected={brigadeId === t.id}
                  onPress={() => setBrigadeId(t.id)}
                />
              ))}
            </View>
          )}
          {!editingAcc ? (
            <>
              <Field
                label="Начальный баланс €"
                value={opening}
                onChangeText={setOpening}
                placeholder="0"
                keyboardType="decimal-pad"
              />
              {opening.length > 0 && openingCents == null ? (
                <Text className="mb-3 text-sm" style={{ color: th.danger }}>
                  Введите сумму и не больше двух знаков после запятой.
                </Text>
              ) : null}
            </>
          ) : null}
          <Button
            label={editingAcc ? "Сохранить" : "Создать"}
            onPress={submitAccount}
            disabled={!canSave}
            loading={insert.isPending || updateAcc.isPending}
          />
          {editingAcc ? (
            <Pressable
              onPress={() => {
                const acc = editingAcc;
                closeCreate();
                confirmClose(acc);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Закрыть счёт ${editingAcc.name}`}
              className="mt-1 items-center py-3 active:opacity-70"
            >
              <Text style={{ fontSize: 16, fontWeight: "500", color: th.danger }}>
                Закрыть счёт
              </Text>
            </Pressable>
          ) : null}
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* transfer */}
      <Modal visible={tOpen} transparent animationType="slide" onRequestClose={() => setTOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setTOpen(false)} accessible={false} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            Перевод между счетами
          </Text>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Откуда</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {/* «Наличка · Юра» — имя бригады различает одноимённые счета */}
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={accountDisplayName(a, teamById.get(a.brigade_id)?.name)}
                color={th.danger}
                selected={fromId === a.id}
                onPress={() => {
                  const nextFrom = a.id === fromId ? null : a.id;
                  setFromId(nextFrom);
                  const selectedTo = accounts.find((item) => item.id === toId);
                  if (nextFrom && selectedTo?.brigade_id !== a.brigade_id) setToId(null);
                }}
              />
            ))}
          </View>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Куда</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {accounts
              .filter(
                (a) =>
                  a.id !== fromId &&
                  (!fromAccount || a.brigade_id === fromAccount.brigade_id),
              )
              .map((a) => (
                <Chip
                  key={a.id}
                  label={accountDisplayName(a, teamById.get(a.brigade_id)?.name)}
                  color={th.success}
                  selected={toId === a.id}
                  onPress={() => setToId(a.id === toId ? null : a.id)}
                />
              ))}
          </View>
          <Field
            label="Сумма €"
            value={tAmount}
            onChangeText={setTAmount}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          {tAmount.length > 0 && transferError ? (
            <Text className="mb-3 text-sm" style={{ color: th.danger }}>
              {transferError}
            </Text>
          ) : null}
          <Button
            label="Перевести"
            onPress={doTransfer}
            disabled={!canTransfer}
            loading={transfer.isPending}
          />
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
