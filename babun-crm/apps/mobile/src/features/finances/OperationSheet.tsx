import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { X } from "lucide-react-native";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { isPaymentAccountCompatible } from "@babun/shared/local/finance/integrity";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useTeams } from "@/features/reference/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useUpdateTransaction,
} from "./queries";
import { useAccountsWithBalances } from "./accounts";
import { useFinanceTemplates, useInsertTemplate } from "./templates-queries";

const PAYMENTS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "transfer", label: "Перевод" },
  { value: "other", label: "Другое" },
];

export function OperationSheet({
  visible,
  onClose,
  defaultTeamId,
  businessToday,
  transaction,
}: {
  visible: boolean;
  onClose: () => void;
  defaultTeamId?: string | null;
  /** Tenant-local YYYY-MM-DD, shared with the database business-day rules. */
  businessToday: string;
  transaction?: FinanceTransaction | null;
}) {
  const th = useThemeColors();
  const { data: categories = [] } = useFinanceCategories();
  const { data: teams = [] } = useTeams();
  // Shares the ["accounts", tenantId, "balances"] cache with the finances
  // screen — one network round-trip instead of a duplicate listAccounts.
  const { data: accounts = [] } = useAccountsWithBalances();
  const { data: templates = [] } = useFinanceTemplates();
  const insertTemplate = useInsertTemplate();
  const insert = useInsertTransaction();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();
  const toast = useToast();
  const isEdit = !!transaction;

  // No free-form «Возврат» here — a real refund is created from the
  // tx-detail popup («Создать возврат»): negative amount + refund_of_id
  // capped by the income's remaining sum (web parity).
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(defaultTeamId ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [date, setDate] = useState(businessToday);
  const [notes, setNotes] = useState("");
  // «Умный дефолт» счёта: пока диспетчер сам не трогал чипы счёта,
  // счёт следует за командой операции (счета строго per-team).
  const [accountTouched, setAccountTouched] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAccountTouched(false);
    if (transaction) {
      setType(transaction.type === "income" ? "income" : "expense");
      setAmount(String(transaction.amount));
      setCategoryId(transaction.category_id ?? null);
      setTeamId(transaction.team_id ?? null);
      setAccountId(transaction.account_id ?? null);
      setPayment((transaction.payment_method as PaymentMethod) ?? "cash");
      setDate(transaction.occurred_on);
      setNotes(transaction.notes ?? "");
    } else {
      setType("expense");
      setAmount("");
      setCategoryId(null);
      setTeamId(defaultTeamId ?? null);
      setAccountId(null);
      setPayment("cash");
      setDate(businessToday);
      setNotes("");
    }
    // Hydrate once per opened transaction id. Depending on the full query
    // object would wipe operator edits on a background cache refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultTeamId, transaction?.id, businessToday]);

  const cats = useMemo(
    () =>
      categories.filter((c) =>
        type === "expense" ? c.type === "expense" : c.type === "income",
      ),
    [categories, type],
  );
  // A tender maps to exactly one account kind. Showing incompatible accounts
  // made it possible to save «Наличные» onto a card balance and discover the
  // mismatch only after a server error.
  const teamAccounts = useMemo(
    () =>
      teamId
        ? accounts.filter(
            (a) =>
              a.brigade_id === teamId &&
              isPaymentAccountCompatible(payment, a.kind),
          )
        : [],
    [accounts, teamId, payment],
  );
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const accountMismatch =
    !!accountId &&
    (!selectedAccount ||
      selectedAccount.brigade_id !== teamId ||
      !isPaymentAccountCompatible(payment, selectedAccount.kind));

  // Дефолт счёта = счёт команды операции. Эффект (а не разовый сет при
  // открытии), потому что счета приезжают асинхронно и команда меняется
  // чипами; ручной выбор/сброс счёта (accountTouched) дефолт отключает.
  useEffect(() => {
    if (!visible || accountTouched) return;
    if (!teamId || accountId !== null) return;
    const def = accounts.find(
      (a) =>
        a.brigade_id === teamId &&
        isPaymentAccountCompatible(payment, a.kind),
    );
    if (def) setAccountId(def.id);
  }, [visible, accountTouched, teamId, accountId, accounts, payment]);

  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;
  const busy = insert.isPending || update.isPending;
  const dateInFuture = date > businessToday;
  const canSave =
    amountCents != null &&
    !!teamId &&
    !!accountId &&
    !accountMismatch &&
    !dateInFuture &&
    !busy;
  const isExpense = type === "expense";

  const save = async () => {
    if (amountCents == null) {
      Alert.alert(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (!teamId || !accountId) {
      Alert.alert("Не выбран счёт", "Выберите команду и счёт для этого способа оплаты.");
      return;
    }
    if (accountMismatch) {
      Alert.alert(
        "Счёт не подходит",
        "Сохранённый счёт относится к другой команде или способу оплаты. Выберите доступный счёт заново.",
      );
      return;
    }
    try {
      const draft = {
        amount: amountNum,
        category_id: categoryId,
        team_id: teamId,
        account_id: accountId,
        payment_method: payment,
        notes: notes.trim() || null,
        occurred_on: date,
        business_today: businessToday,
      };
      if (isEdit && transaction) {
        await update.mutateAsync({ id: transaction.id, patch: draft });
      } else {
        await insert.mutateAsync({ type, ...draft });
      }
      toast(isEdit ? "Сохранено" : "Операция добавлена");
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  // «+ Шаблон» — инлайн-создание шаблона из заполненной формы (labeled,
  // не голый глиф): следующая такая же операция становится 3 тапа
  // Быстрое создание открывается из подписанного действия. CRUD-экран остаётся в Кабинете.
  const createTemplate = async (name: string) => {
    try {
      await insertTemplate.mutateAsync({
        name,
        kind: type,
        amount: amountNum,
        category_id: categoryId,
        brigade_id: teamId,
        account_id: accountId,
        payment_method: payment,
      });
      toast("Шаблон сохранён");
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };
  const saveAsTemplate = () => {
    if (amountCents == null) {
      toast("Введите сумму с точностью не больше двух знаков");
      return;
    }
    if (!teamId || !accountId) {
      toast("Выберите команду и счёт для шаблона");
      return;
    }
    if (accountMismatch) {
      toast("Выберите счёт, подходящий способу оплаты");
      return;
    }
    const fallback =
      notes.trim() ||
      (categoryId
        ? categories.find((c) => c.id === categoryId)?.name
        : undefined) ||
      (isExpense ? "Расход" : "Доход");
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Название шаблона",
        "Появится чипом наверху этой формы",
        [
          { text: "Отмена", style: "cancel" },
          {
            text: "Сохранить",
            onPress: (v: string | undefined) =>
              void createTemplate((v ?? "").trim() || fallback),
          },
        ],
        "plain-text",
        fallback,
      );
    } else {
      void createTemplate(fallback);
    }
  };

  const remove = () => {
    if (!transaction) return;
    Alert.alert("Удалить операцию?", "", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await del.mutateAsync(transaction.id);
            onClose();
          } catch (e) {
            Alert.alert("Ошибка", (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View className="flex-1 justify-end" style={{ backgroundColor: th.scrim }}>
        <Pressable className="flex-1" onPress={onClose} accessible={false} />
        <View className="h-[86%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: th.canvas }}>
          <View className="flex-row items-center px-2 py-2" style={{ backgroundColor: th.surface, borderBottomWidth: 1, borderBottomColor: th.separator }}>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={th.body} size={ICON.md} />
            </Pressable>
            <Text className="flex-1 text-center text-base font-semibold" style={{ color: th.ink }}>
              {isEdit ? "Операция" : "Новая операция"}
            </Text>
            {isEdit ? (
              <Pressable
                onPress={remove}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Удалить операцию"
                className="min-h-10 w-10 items-center justify-center"
              >
                <Text className="text-sm font-medium" style={{ color: th.danger }}>Удалить</Text>
              </Pressable>
            ) : (
              <View className="w-10" />
            )}
          </View>

          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {/* template quick-chips + labeled inline «+ Шаблон» */}
            {!isEdit ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, maxHeight: 50 }}
                contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, gap: 8, alignItems: "center" }}
              >
                {templates.map((t) => (
                  <Chip
                    key={t.id}
                    label={`${t.name} · ${formatEUR(Number(t.amount))}`}
                    variant="outline"
                    onPress={() => {
                      const nextPayment =
                        (t.payment_method as PaymentMethod | null) ?? payment;
                      const nextTeamId = t.brigade_id ?? teamId;
                      const templateAccount = t.account_id
                        ? accounts.find((a) => a.id === t.account_id)
                        : null;
                      const templateAccountFits =
                        !!templateAccount &&
                        !!nextTeamId &&
                        templateAccount.brigade_id === nextTeamId &&
                        isPaymentAccountCompatible(nextPayment, templateAccount.kind);
                      setType(t.kind);
                      setAmount(String(t.amount));
                      setCategoryId(t.category_id ?? null);
                      setPayment(nextPayment);
                      if (t.brigade_id) setTeamId(t.brigade_id);
                      if (templateAccountFits) {
                        setAccountId(templateAccount.id);
                        setAccountTouched(true);
                      } else {
                        setAccountId(null);
                        setAccountTouched(false);
                        if (t.account_id) {
                          toast("В шаблоне устарел счёт — выберите доступный");
                        }
                      }
                    }}
                  />
                ))}
                <Chip
                  label="Сохранить шаблон"
                  variant="outline"
                  color={th.accent}
                  onPress={saveAsTemplate}
                  accessibilityLabel="Сохранить заполненную форму как шаблон"
                />
              </ScrollView>
            ) : null}

            {/* type segmented */}
            <SegmentedControl
              options={[
                { value: "expense", label: "Расход", color: th.danger },
                { value: "income", label: "Доход", color: th.success },
              ]}
              value={type}
              onChange={(seg) => {
                setType(seg);
                setCategoryId(null);
              }}
              disabled={isEdit}
              style={{ marginHorizontal: 12, marginTop: 12 }}
            />

            {/* amount */}
            <SectionCard title="Сумма">
              <View className="flex-row items-center px-4 py-2.5">
                <TextInput
                  value={amount}
                  accessibilityLabel="Сумма операции"
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  autoFocus
                  placeholder="0"
                  placeholderTextColor={th.placeholder}
                  selectionColor={th.accent}
                  keyboardAppearance="light"
                  className="flex-1 text-3xl font-bold"
                  style={{ color: isExpense ? th.danger : th.success }}
                />
                <Text className="text-3xl font-bold" style={{ color: th.faint }}>€</Text>
              </View>
            </SectionCard>

            {/* category */}
            {cats.length > 0 ? (
              <SectionCard title="Категория">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    gap: 8,
                  }}
                >
                  {cats.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      selected={categoryId === c.id}
                      color={isExpense ? th.danger : th.success}
                      onPress={() =>
                        setCategoryId(categoryId === c.id ? null : c.id)
                      }
                    />
                  ))}
                </ScrollView>
              </SectionCard>
            ) : null}

            {/* team */}
            {teams.length > 0 ? (
              <SectionCard title="Команда">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    gap: 8,
                  }}
                >
                  {teams.map((t) => (
                    <Chip
                      key={t.id}
                      label={t.name}
                      selected={teamId === t.id}
                      onPress={() => {
                        setTeamId(teamId === t.id ? null : t.id);
                        // смена команды = новый контекст счёта: сброс к
                        // дефолту «счёт команды» (эффект выше подхватит)
                        setAccountId(null);
                        setAccountTouched(false);
                      }}
                    />
                  ))}
                </ScrollView>
              </SectionCard>
            ) : null}

            {/* account */}
            {teamAccounts.length > 0 ? (
              <SectionCard title="Счёт">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    gap: 8,
                  }}
                >
                  {teamAccounts.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      selected={accountId === a.id}
                      onPress={() => {
                        setAccountTouched(true);
                        setAccountId(accountId === a.id ? null : a.id);
                      }}
                    />
                  ))}
                </ScrollView>
              </SectionCard>
            ) : null}

            {/* payment + date */}
            <SectionCard title="Оплата">
              <View className="flex-row flex-wrap gap-2 p-3">
                {PAYMENTS.map((p) => (
                  <Chip
                    key={p.value}
                    label={p.label}
                    selected={payment === p.value}
                    radio
                    onPress={() => {
                      if (payment === p.value) return;
                      setPayment(p.value);
                      if (
                        !selectedAccount ||
                        !isPaymentAccountCompatible(p.value, selectedAccount.kind)
                      ) {
                        setAccountId(null);
                        setAccountTouched(false);
                      }
                    }}
                  />
                ))}
              </View>
              <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />
              <View className="flex-row items-center justify-between px-4 py-2.5">
                <Text className="text-base" style={{ color: th.ink }}>Дата</Text>
                <DateTimePicker
                  value={parseYMD(date)}
                  maximumDate={parseYMD(businessToday)}
                  mode="date"
                  display="compact"
                  themeVariant="light"
                  onChange={(_, d) => d && setDate(formatYMD(d))}
                />
              </View>
            </SectionCard>

            {/* notes */}
            <SectionCard title="Заметка">
              <TextInput
                value={notes}
                accessibilityLabel="Заметка к операции"
                onChangeText={setNotes}
                placeholder="Напр. бензин, материалы…"
                placeholderTextColor={th.placeholder}
                selectionColor={th.accent}
                keyboardAppearance="light"
                className="px-4 py-3 text-base"
                style={{ color: th.ink }}
              />
            </SectionCard>

            <View className="h-6" />
          </ScrollView>

          <View className="px-4 pb-7 pt-3" style={{ backgroundColor: th.surface, borderTopWidth: 1, borderTopColor: th.separator }}>
            {amount.length > 0 && amountCents == null ? (
              <Text className="mb-2 text-center text-sm" style={{ color: th.danger }}>
                Введите сумму больше нуля и не больше двух знаков после запятой
              </Text>
            ) : dateInFuture ? (
              <Text className="mb-2 text-center text-sm" style={{ color: th.danger }}>
                Финансовую операцию нельзя записать будущей датой
              </Text>
            ) : accountMismatch ? (
              <Text className="mb-2 text-center text-sm" style={{ color: th.danger }}>
                Сохранённый счёт не подходит. Выберите доступный счёт заново
              </Text>
            ) : teamId && teamAccounts.length === 0 ? (
              <Text className="mb-2 text-center text-sm" style={{ color: th.danger }}>
                Для этого способа оплаты у команды нет активного счёта
              </Text>
            ) : amountCents != null && (!teamId || !accountId) ? (
              <Text className="mb-2 text-center text-sm" style={{ color: th.danger }}>
                Выберите команду и счёт для способа оплаты
              </Text>
            ) : null}
            <Button
              label={
                isEdit
                  ? "Сохранить"
                  : isExpense
                    ? "Добавить расход"
                    : "Добавить доход"
              }
              onPress={save}
              disabled={!canSave}
              loading={busy}
            />
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
