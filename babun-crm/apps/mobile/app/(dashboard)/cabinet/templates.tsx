import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Trash2 } from "lucide-react-native";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { isPaymentAccountCompatible } from "@babun/shared/local/finance/integrity";
import type { PaymentMethod } from "@babun/shared/local/finance/transaction";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddRow } from "@/components/ui/AddRow";
import { Divider } from "@/components/ui/Divider";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useFinanceCategories } from "@/features/finances/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import {
  useDeleteTemplate,
  useFinanceTemplates,
  useInsertTemplate,
  useUpdateTemplate,
  type FinanceTemplate,
} from "@/features/finances/templates-queries";

// Шаблоны операций — чип-строка над формой «+ Доход/Расход». Экран задаёт
// ВСЕ поля, которые чип реально применяет (OperationSheet.tsx: сумма,
// категория, способ оплаты, бригада, счёт) — раньше здесь были только
// name/kind/amount/category, а полноценный шаблон можно было получить лишь
// инлайн-захватом из формы операции; редактирования не было вовсе
// (аудит P1-7).

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "transfer", label: "Перевод" },
  { value: "other", label: "Другое" },
];
const methodLabel = (m: PaymentMethod | null) =>
  METHODS.find((x) => x.value === m)?.label ?? null;

export default function TemplatesScreen() {
  const templatesQuery = useFinanceTemplates();
  const categoriesQuery = useFinanceCategories();
  const teamsQuery = useTeams();
  const accountsQuery = useAccountsWithBalances();
  const templates = useMemo(
    () => templatesQuery.data ?? [],
    [templatesQuery.data],
  );
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const insert = useInsertTemplate();
  const update = useUpdateTemplate();
  const del = useDeleteTemplate();
  const t = useThemeColors();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTemplate | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>("cash");
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  const cats = useMemo(
    () => categories.filter((c) => c.type === kind),
    [categories, kind],
  );
  // Счета строго per-brigade (финансы v5): чипы счёта появляются после
  // выбора бригады и только её счета.
  const brigadeAccounts = useMemo(
    () =>
      brigadeId && method
        ? accounts.filter(
            (a) =>
              a.brigade_id === brigadeId &&
              isPaymentAccountCompatible(method, a.kind),
          )
        : [],
    [accounts, brigadeId, method],
  );
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const accountMismatch =
    !!accountId &&
    (!selectedAccount ||
      selectedAccount.brigade_id !== brigadeId ||
      !isPaymentAccountCompatible(method, selectedAccount.kind));
  const teamName = useMemo(
    () => new Map(teams.map((tm) => [tm.id, tm.name])),
    [teams],
  );

  // Comma decimals («12,50» from the ru decimal-pad) must pass the same
  // normalisation as submit(), otherwise the button never enables.
  const amountCents = parseMoneyInputToCents(amount);
  const busy = insert.isPending || update.isPending;
  const canSave =
    !!name.trim() &&
    amountCents != null &&
    !!method &&
    !!brigadeId &&
    !!accountId &&
    !accountMismatch &&
    !busy;
  const loading =
    templatesQuery.isLoading ||
    categoriesQuery.isLoading ||
    teamsQuery.isLoading ||
    accountsQuery.isLoading;
  const loadError =
    (templatesQuery.data === undefined ? templatesQuery.error : null) ||
    (categoriesQuery.data === undefined ? categoriesQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      templatesQuery.refetch(),
      categoriesQuery.refetch(),
      teamsQuery.refetch(),
      accountsQuery.refetch(),
    ]);

  useEffect(() => {
    if (!open || accountId || brigadeAccounts.length === 0) return;
    setAccountId(brigadeAccounts[0].id);
  }, [open, accountId, brigadeAccounts]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setKind("expense");
    setAmount("");
    setCategoryId(null);
    setMethod("cash");
    setBrigadeId(null);
    setAccountId(null);
    setOpen(true);
  };
  const openEdit = (tpl: FinanceTemplate) => {
    setEditing(tpl);
    setName(tpl.name);
    setKind(tpl.kind);
    setAmount(String(tpl.amount));
    setCategoryId(tpl.category_id);
    setMethod(tpl.payment_method);
    setBrigadeId(tpl.brigade_id);
    setAccountId(tpl.account_id);
    setOpen(true);
  };

  const submit = async () => {
    if (amountCents == null) {
      Alert.alert(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (!method || !brigadeId || !accountId) {
      Alert.alert(
        "Не заполнена оплата",
        "Выберите способ оплаты, команду и подходящий финансовый счёт.",
      );
      return;
    }
    if (accountMismatch) {
      Alert.alert(
        "Счёт не подходит",
        "Сохранённый счёт относится к другой команде или способу оплаты. Выберите доступный счёт заново.",
      );
      return;
    }
    const draft = {
      name: name.trim(),
      kind,
      amount: amountCents / 100,
      category_id: categoryId,
      payment_method: method,
      brigade_id: brigadeId,
      // Счёт живёт только вместе со своей бригадой.
      account_id: brigadeId ? accountId : null,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: draft });
      else await insert.mutateAsync(draft);
      setOpen(false);
      setEditing(null);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (id: string, label: string) =>
    Alert.alert("Удалить шаблон?", label, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () =>
          del.mutate(id, { onError: (e) => Alert.alert("Ошибка", e.message) }),
      },
    ]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Шаблоны транзакций" />
      {loading ? (
        <EmptyState state="loading" fill />
      ) : loadError ? (
        <EmptyState
          fill
          state="error"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={templates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1, paddingTop: 8 }}
          renderItem={({ item }) => {
            // Подзаголовок повторяет веб-строку: вид · способ · бригада.
            const bits = [
              item.kind === "expense" ? "Расход" : "Доход",
              methodLabel(item.payment_method),
              item.brigade_id ? teamName.get(item.brigade_id) : null,
            ].filter(Boolean);
            return (
              <View className="flex-row items-stretch">
                <Pressable
                  onPress={() => openEdit(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Шаблон ${item.name}, редактировать`}
                  className="min-h-[52px] flex-1 flex-row items-center py-3 pl-4 active:opacity-60"
                >
                  <View className="flex-1 pr-2">
                  <Text
                    className="text-base font-semibold"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text className="text-xs" style={{ color: t.faint }} numberOfLines={1}>
                    {bits.join(" · ")}
                  </Text>
                  </View>
                  <Text
                    className="mr-2 text-base font-bold tabular-nums"
                    style={{ color: item.kind === "expense" ? t.danger : t.success }}
                  >
                    {formatEUR(Number(item.amount))}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(item.id, item.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить шаблон ${item.name}`}
                  className="min-h-[52px] min-w-11 items-center justify-center pr-2 active:opacity-60"
                >
                  <Trash2 color={t.danger} size={ICON.sm} />
                </Pressable>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <Divider inset={16} />}
          ListFooterComponent={
            templates.length > 0 ? (
              <>
                <Divider inset={16} />
                <AddRow label="Добавить шаблон" onPress={openCreate} />
              </>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              fill
              title="Нет шаблонов"
              subtitle="Частые операции (Аренда, Бензин…) — заведите шаблон и добавляйте их в один тап"
              action={{ label: "Добавить шаблон", onPress: openCreate }}
            />
          }
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: t.scrim }}
          onPress={() => setOpen(false)}
          accessible={false}
        />
        <View
          className="max-h-[80%] rounded-t-3xl"
          style={{ backgroundColor: t.surface }}
        >
        <ScrollView
          className="p-5"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
            {editing ? "Шаблон" : "Новый шаблон"}
          </Text>
          <SegmentedControl
            options={[
              { value: "expense", label: "Расход", color: t.danger },
              { value: "income", label: "Доход", color: t.success },
            ]}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCategoryId(null);
            }}
            style={{ marginBottom: 12 }}
          />
          <Field label="Название" value={name} onChangeText={setName} placeholder="Аренда" autoFocus={!editing} />
          <Field
            label="Сумма €"
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          {amount.length > 0 && amountCents == null ? (
            <Text className="mb-3 text-sm" style={{ color: t.danger }}>
              Введите сумму больше нуля и не больше двух знаков после запятой.
            </Text>
          ) : null}
          {cats.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Категория</Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {cats.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    radio
                    selected={categoryId === c.id}
                    onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Способ оплаты</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {METHODS.map((m) => (
              <Chip
                key={m.value}
                label={m.label}
                radio
                selected={method === m.value}
                onPress={() => {
                  const nextMethod = method === m.value ? null : m.value;
                  setMethod(nextMethod);
                  if (
                    !selectedAccount ||
                    !isPaymentAccountCompatible(nextMethod, selectedAccount.kind)
                  ) {
                    setAccountId(null);
                  }
                }}
              />
            ))}
          </View>
          {teams.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Бригада</Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {teams.map((tm) => (
                  <Chip
                    key={tm.id}
                    label={tm.name}
                    radio
                    selected={brigadeId === tm.id}
                    onPress={() => {
                      const next = brigadeId === tm.id ? null : tm.id;
                      setBrigadeId(next);
                      setAccountId(null);
                    }}
                  />
                ))}
              </View>
            </>
          ) : null}
          {brigadeAccounts.length > 0 ? (
            <>
              <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>Счёт</Text>
              <View className="mb-3 flex-row flex-wrap gap-2">
                {brigadeAccounts.map((a) => (
                  <Chip
                    key={a.id}
                    label={a.name}
                    radio
                    selected={accountId === a.id}
                    onPress={() => setAccountId(accountId === a.id ? null : a.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          {accountMismatch ? (
            <Text className="mb-3 text-sm" style={{ color: t.danger }}>
              Сохранённый счёт больше не подходит. Выберите доступный счёт заново.
            </Text>
          ) : brigadeId && method && brigadeAccounts.length === 0 ? (
            <Text className="mb-3 text-sm" style={{ color: t.danger }}>
              Для этого способа оплаты у команды нет активного счёта.
            </Text>
          ) : !method || !brigadeId || !accountId ? (
            <Text className="mb-3 text-sm" style={{ color: t.sub }}>
              Для рабочего шаблона нужны способ оплаты, команда и счёт.
            </Text>
          ) : null}
          <Button
            label={editing ? "Сохранить" : "Создать"}
            onPress={submit}
            disabled={!canSave}
            loading={busy}
          />
        </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
