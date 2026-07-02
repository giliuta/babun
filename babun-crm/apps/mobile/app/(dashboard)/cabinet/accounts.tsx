import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, Text, View } from "react-native";
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  Plus,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import type { AccountKind } from "@babun/shared/local/finance/account";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
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
  const { data: teams = [] } = useTeams();
  const insert = useInsertAccount();
  const closeAcc = useSoftCloseAccount();
  const transfer = useCreateTransfer();

  const teamName = useMemo(
    () => new Map(teams.map((t) => [t.id, t.name])),
    [teams],
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
          <View className="flex-row items-center">
            {accounts.length >= 2 ? (
              <Pressable
                onPress={() => setTOpen(true)}
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
              >
                <ArrowLeftRight color={th.body} size={ICON.sm} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setOpen(true)}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
            >
              <Plus color={th.accent} size={ICON.md} />
            </Pressable>
          </View>
        }
      />

      <View className="mx-3 mt-2 rounded-2xl p-4 shadow-sm" style={{ backgroundColor: th.surface }}>
        <Text className="text-xs" style={{ color: th.sub }}>Всего на счетах</Text>
        <Text
          className="mt-0.5 text-2xl font-bold"
          style={{ color: th.brandAccent }}
        >
          {formatEUR(total)}
        </Text>
      </View>

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
            return (
              <Pressable
                // A plain tap must never be destructive — everywhere else in
                // the app a row tap means «открыть». Closing stays on
                // long-press, mirrored as an explicit accessibility action so
                // VoiceOver users (who can't long-press) still reach it.
                onLongPress={() => confirmClose(item)}
                accessibilityLabel={`${item.name}, ${formatEUR(item.balance)}`}
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
                  <Text className="text-xs" style={{ color: th.sub }}>
                    {teamName.get(item.brigade_id) ?? "—"}
                  </Text>
                </View>
                <Text className="text-base font-bold tabular-nums" style={{ color: th.ink }}>
                  {formatEUR(item.balance)}
                </Text>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет счетов"
              subtitle="Добавьте кассу или карту бригады через +"
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setOpen(false)} />
        <View className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
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
              <Pressable
                key={k.value}
                onPress={() => setKind(k.value)}
                className="rounded-full px-3.5 py-1.5"
                style={{ backgroundColor: kind === k.value ? th.accent : (th.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
              >
                <Text className="text-sm font-medium" style={{ color: kind === k.value ? "#fff" : th.sub }}>
                  {k.label}
                </Text>
              </Pressable>
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
                <Pressable
                  key={t.id}
                  onPress={() => setBrigadeId(t.id)}
                  className="rounded-full px-3.5 py-1.5"
                  style={{ backgroundColor: brigadeId === t.id ? th.accent : (th.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
                >
                  <Text className="text-sm font-medium" style={{ color: brigadeId === t.id ? "#fff" : th.sub }}>
                    {t.name}
                  </Text>
                </Pressable>
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
      </Modal>

      {/* transfer */}
      <Modal visible={tOpen} transparent animationType="slide" onRequestClose={() => setTOpen(false)}>
        <Pressable className="flex-1" style={{ backgroundColor: th.scrim }} onPress={() => setTOpen(false)} />
        <View className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-5 pb-8" style={{ backgroundColor: th.surface }}>
          <Text className="mb-3 text-lg font-bold" style={{ color: th.ink }}>
            Перевод между счетами
          </Text>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Откуда</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {accounts.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => setFromId(a.id === fromId ? null : a.id)}
                className="rounded-full px-3.5 py-1.5"
                style={{ backgroundColor: fromId === a.id ? th.danger : (th.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
              >
                <Text className="text-sm font-medium" style={{ color: fromId === a.id ? "#fff" : th.sub }}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="mb-2 text-xs font-medium" style={{ color: th.sub }}>Куда</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {accounts
              .filter((a) => a.id !== fromId)
              .map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setToId(a.id === toId ? null : a.id)}
                  className="rounded-full px-3.5 py-1.5"
                  style={{ backgroundColor: toId === a.id ? th.success : (th.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
                >
                  <Text className="text-sm font-medium" style={{ color: toId === a.id ? "#fff" : th.sub }}>
                    {a.name}
                  </Text>
                </Pressable>
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
      </Modal>
    </Screen>
  );
}
