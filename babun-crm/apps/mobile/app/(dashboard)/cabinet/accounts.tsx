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
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  accountDisplayName,
  type AccountKind,
} from "@babun/shared/local/finance/account";
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
import { formatYMD } from "@/features/appointments/helpers";
import {
  useAccountsWithBalances,
  useCreateTransfer,
  useInsertAccount,
  useSoftCloseAccount,
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
  const { data: accounts = [], isLoading } = useAccountsWithBalances();
  // Активные — для чипов «Бригада» в форме создания; ВСЕ (вкл. soft-deleted)
  // — для резолва подзаголовков: счёт живёт дольше своей команды, и его
  // имя обязано резолвиться, иначе две «Налички» неразличимы.
  const { data: teams = [] } = useTeams();
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const insert = useInsertAccount();
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

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("cash");
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");

  // Умный дефолт: одна команда — значит счёт её; выбирать нечего.
  const openCreate = (presetBrigadeId?: string) => {
    setBrigadeId(
      presetBrigadeId ?? (teams.length === 1 ? teams[0].id : null),
    );
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

  const tNum = Number(tAmount.replace(",", ".")) || 0;
  const canTransfer =
    !!fromId && !!toId && fromId !== toId && tNum > 0 && !transfer.isPending;

  const doTransfer = async () => {
    if (!fromId || !toId) return;
    try {
      await transfer.mutateAsync({
        from_account_id: fromId,
        to_account_id: toId,
        amount: tNum,
        occurred_on: formatYMD(new Date()),
      });
      setFromId(null);
      setToId(null);
      setTAmount("");
      setTOpen(false);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const reset = () => {
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
  const canSave = !!name.trim() && !!brigadeId && !insert.isPending;

  const add = async () => {
    if (!brigadeId) return;
    try {
      await insert.mutateAsync({
        name: name.trim(),
        kind,
        brigade_id: brigadeId,
        opening_balance: Number(opening.replace(",", ".")) || 0,
      });
      reset();
      setOpen(false);
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const confirmClose = (a: AccountWithBalance) =>
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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Счета"
        right={
          accounts.length >= 2 ? (
            <Pressable
              onPress={() => setTOpen(true)}
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

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={accounts}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => {
            const Icon = KIND_ICON[item.kind];
            // Счета строго per-brigade: подзаголовок = имя команды (это
            // единственное, что различает две «Налички»). Никаких «—»-
            // плейсхолдеров; оборванная ссылка читается как «Без бригады».
            const team = teamById.get(item.brigade_id);
            const teamLabel = team?.name ?? "Без бригады";
            return (
              <Pressable
                // A plain tap must never be destructive — everywhere else in
                // the app a row tap means «открыть». Closing stays on
                // long-press, mirrored as an explicit accessibility action so
                // VoiceOver users (who can't long-press) still reach it.
                onLongPress={() => confirmClose(item)}
                accessibilityLabel={`${item.name}, ${teamLabel}, ${formatEUR(item.balance)}`}
                accessibilityHint="Долгое нажатие закрывает счёт"
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
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeCreate}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={closeCreate} />
        <View className="rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>Новый счёт</Text>
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
          <Field
            label="Начальный баланс €"
            value={opening}
            onChangeText={setOpening}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <Button
            label="Создать"
            onPress={add}
            disabled={!canSave}
            loading={insert.isPending}
          />
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* transfer */}
      <Modal visible={tOpen} transparent animationType="slide" onRequestClose={() => setTOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setTOpen(false)} />
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
                onPress={() => setFromId(a.id === fromId ? null : a.id)}
              />
            ))}
          </View>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Куда</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {accounts
              .filter((a) => a.id !== fromId)
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
