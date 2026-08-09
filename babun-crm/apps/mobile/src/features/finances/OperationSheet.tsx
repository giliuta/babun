import { useEffect, useMemo, useRef, useState } from "react";
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
import { ChevronRight, X } from "lucide-react-native";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { OperationReceiptRow } from "./OperationReceiptRow";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  applyTxVat,
  defaultTxVatMode,
  inputFromGross,
  TX_VAT_MODE_LABELS,
  type TxVatMode,
} from "@babun/shared/local/finance/vat";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "./vat-queries";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import {
  accountServesTeam,
  isPaymentAccountCompatible,
} from "@babun/shared/local/finance/integrity";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useRouter } from "expo-router";
import { useTeams } from "@/features/reference/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useUpdateTransaction,
} from "./queries";
import { useAccountsWithBalances } from "./accounts";

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
  const insert = useInsertTransaction();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();
  const toast = useToast();
  const isEdit = !!transaction;
  const router = useRouter();

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
  // Документ, подтверждающий операцию (путь в приватном бакете).
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Категория выбирается ЛИСТОМ, а не лентой чипов: категорий бывает два
  // десятка, и половина ленты всегда за краем экрана.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  // Три клавиши НДС на самой операции. Владелец 2026-08-09: «не всегда надо
  // указывать НДС — иногда есть оплаты без него, это надо самому
  // регулировать». Пока не тронули руками, режим следует за настройкой
  // счёта/команды/компании.
  const [vatMode, setVatMode] = useState<TxVatMode>("none");
  const [vatTouched, setVatTouched] = useState(false);
  // «Умный дефолт» счёта: пока диспетчер сам не трогал чипы счёта,
  // счёт следует за командой операции (счета строго per-team).
  const [accountTouched, setAccountTouched] = useState(false);
  // Идемпотентность вставки: клиентский PK, новый после каждого успеха.
  const [requestId, setRequestId] = useState(randomUuid);
  const savingRef = useRef(false);

  // Гидрация ТОЛЬКО по фронту открытия/смене операции: смена businessToday
  // в полночь или фоновый рефетч не должны стирать заполняемую форму.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      hydratedFor.current = null;
      return;
    }
    const key = transaction?.id ?? "new";
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;
    setRequestId(randomUuid());
    setAccountTouched(false);
    if (transaction) {
      setType(transaction.type === "income" ? "income" : "expense");
      const txVat: TxVatMode =
        transaction.vat_mode ?? (transaction.vat_amount ? "inclusive" : "none");
      setVatMode(txVat);
      setVatTouched(true);
      setAmount(
        String(
          inputFromGross(
            transaction.amount,
            txVat,
            Number(transaction.vat_rate ?? 0),
          ),
        ),
      );
      setCategoryId(transaction.category_id ?? null);
      setTeamId(transaction.team_id ?? null);
      setAccountId(transaction.account_id ?? null);
      setPayment((transaction.payment_method as PaymentMethod) ?? "cash");
      setDate(transaction.occurred_on);
      setNotes(transaction.notes ?? "");
      setReceiptUrl(transaction.receipt_url ?? null);
    } else {
      setType("expense");
      setVatTouched(false);
      setAmount("");
      setCategoryId(null);
      setTeamId(defaultTeamId ?? null);
      setAccountId(null);
      setPayment("cash");
      setDate(businessToday);
      setNotes("");
      setReceiptUrl(null);
    }
    // Hydrate once per opened transaction id (guarded by hydratedFor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultTeamId, transaction?.id, businessToday]);

  const categoryName =
    categories.find((c) => c.id === categoryId)?.name ?? null;

  // Скрытые тенантом категории не предлагаются — кроме той, что уже стоит в
  // редактируемой операции: молча снять с неё категорию нельзя.
  const cats = useMemo(
    () =>
      categories.filter(
        (c) =>
          c.type === (type === "expense" ? "expense" : "income") &&
          (!c.hidden || c.id === categoryId),
      ),
    [categories, type, categoryId],
  );
  // A tender maps to exactly one account kind. Showing incompatible accounts
  // made it possible to save «Наличные» onto a card balance and discover the
  // mismatch only after a server error. Командные счета идут раньше общих —
  // тот же приоритет, что у серверного resolve.
  const teamAccounts = useMemo(
    () =>
      teamId
        ? accounts
            // Способ оплаты НЕ фильтрует счета: он из счёта и выводится.
            // Раньше эти два контрола фильтровали друг друга, и человек
            // выбирал одно и то же дважды — сначала «Карта», потом «Карта».
            .filter((a) => accountServesTeam(a, teamId))
            .sort((a, b) =>
              a.scope === b.scope
                ? a.position - b.position
                : a.scope === "team"
                  ? -1
                  : 1,
            )
        : [],
    [accounts, teamId],
  );
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const accountMismatch =
    !!accountId &&
    (!selectedAccount ||
      !teamId ||
      !accountServesTeam(selectedAccount, teamId) ||
      !isPaymentAccountCompatible(payment, selectedAccount.kind));

  // ДЕЙСТВУЮЩИЙ НАЛОГ ЭТОЙ ОПЕРАЦИИ: счёт → команда → компания.
  const vatSettingsQuery = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
  const vat = effectiveVatSettings(
    vatSettingsQuery.data,
    (teamVatOverrides.data ?? []).find((o) => o.teamId === teamId),
    selectedAccount?.vat_mode ?? null,
  );
  // Компания с выключенным налогом не должна видеть слово «НДС» вообще.
  const vatVisible = vat.mode !== "off" && vat.rate > 0;

  // Дефолт счёта = счёт команды операции (командный раньше общего). Эффект
  // (а не разовый сет при открытии), потому что счета приезжают асинхронно
  // и команда меняется чипами; ручной выбор/сброс (accountTouched) дефолт
  // отключает.
  useEffect(() => {
    if (!visible || accountTouched || isEdit) return;
    if (!teamId || accountId !== null) return;
    const def = teamAccounts[0];
    if (def) setAccountId(def.id);
  }, [visible, accountTouched, isEdit, teamId, accountId, teamAccounts]);

  // Пока диспетчер не нажал клавишу сам, режим идёт за настройкой счёта.
  // Зависимость — ПОЛЯ настройки, а не сам объект: effectiveVatSettings
  // собирает новый объект на каждый рендер, и эффект зациклился бы.
  const vatModeSetting = vat.mode;
  const vatRateSetting = vat.rate;
  useEffect(() => {
    if (!visible || vatTouched || isEdit) return;
    setVatMode(
      defaultTxVatMode({
        mode: vatModeSetting,
        rate: vatRateSetting,
        exemptionNote: null,
      }),
    );
  }, [visible, vatTouched, isEdit, vatModeSetting, vatRateSetting]);

  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;
  const vatBreakdown = applyTxVat(amountNum, vatMode, vat.rate);
  const busy = insert.isPending || update.isPending || del.isPending;
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
    // Синхронный гард: isPending включается только после ре-рендера,
    // сверхбыстрый двойной тап успевал бы дважды.
    if (savingRef.current) return;
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
    savingRef.current = true;
    try {
      const breakdown = applyTxVat(amountNum, vatMode, vat.rate);
      const draft = {
        amount: breakdown.gross,
        vat_mode: vatMode,
        category_id: categoryId,
        team_id: teamId,
        account_id: accountId,
        payment_method: payment,
        notes: notes.trim() || null,
        occurred_on: date,
        receipt_url: receiptUrl,
        business_today: businessToday,
      };
      if (isEdit && transaction) {
        await update.mutateAsync({ id: transaction.id, patch: draft });
      } else {
        // request_id стабилен на время попытки: ретрай после потерянного
        // ответа не задваивает деньги (duplicate key = успех в репозитории).
        await insert.mutateAsync({ type, request_id: requestId, ...draft });
        setRequestId(randomUuid());
      }
      toast(isEdit ? "Сохранено" : "Операция добавлена");
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
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
            {/* ПОРЯДОК ПОЛЕЙ — КАК ЧЕЛОВЕК ДУМАЕТ (владелец 2026-08-09):
                расход/доход → команда и дата → категория → сумма → счёт →
                заметка → документ. Компактно: каждая строка ровно на своё
                содержимое, лист не растянут на весь экран.

                Полосы шаблонов здесь больше нет: она первой встречала на
                экране создания и занимала место под то, чем пользуются раз в
                месяц. Шаблоны живут в настройках финансов. */}

            {/* 1. Расход | Доход */}
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

            {/* 2. Команда и дата ОДНОЙ карточкой. Команда не выбирается: она
                уже выбрана чипом наверху экрана, и второй выбор того же —
                лишний вопрос. Здесь она просто подписана. */}
            <SectionCard>
              <View className="flex-row items-center justify-between px-4 py-2.5">
                <Text className="text-base" style={{ color: th.sub }}>
                  Команда
                </Text>
                <Text
                  className="text-base font-semibold"
                  style={{ color: th.ink }}
                  numberOfLines={1}
                >
                  {teamId
                    ? (teams.find((t) => t.id === teamId)?.name ?? "Команда")
                    : "Компания"}
                </Text>
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
                  locale="ru-RU"
                  onChange={(_, d) => d && setDate(formatYMD(d))}
                />
              </View>
            </SectionCard>

            {/* 3. Категория — СТРОКА, а не полоса чипов: категорий бывает
                два десятка, и горизонтальная лента прячет половину за краем.
                Свои категории заводятся в настройках, и дорога туда лежит
                внутри выбора — там, где рука уже находится. */}
            <SectionCard>
              <Pressable
                onPress={() => setCategoryPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Категория: ${categoryName ?? "не выбрана"}`}
                className="min-h-[48px] flex-row items-center px-4 py-2.5"
                style={({ pressed }) => ({
                  backgroundColor: pressed ? th.pressed : "transparent",
                })}
              >
                <Text className="text-base" style={{ color: th.ink }}>
                  Категория
                </Text>
                <View className="ml-auto flex-row items-center gap-1.5">
                  <Text
                    className="text-base"
                    style={{ color: categoryName ? th.ink : th.faint }}
                    numberOfLines={1}
                  >
                    {categoryName ?? "Выбрать"}
                  </Text>
                  <ChevronRight color={th.chevron} size={17} strokeWidth={2.2} />
                </View>
              </Pressable>
            </SectionCard>

            {/* 4. Сумма */}
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

            {/* 4a. НДС — ТРИ КЛАВИШИ. Появляются только у тех, кто с налогом
                работает: выключили в настройках — слова «НДС» в форме нет.
                Под клавишами стоит последствие в евро, потому что разница
                между «включён» и «плюсом» — это деньги, а не термин. */}
            {vatVisible ? (
              <SectionCard title="НДС">
                <View className="flex-row flex-wrap gap-2 px-3 py-3">
                  {(["none", "inclusive", "exclusive"] as TxVatMode[]).map(
                    (m) => (
                      <Chip
                        key={m}
                        label={TX_VAT_MODE_LABELS[m]}
                        radio
                        selected={vatMode === m}
                        onPress={() => {
                          setVatTouched(true);
                          setVatMode(m);
                        }}
                      />
                    ),
                  )}
                </View>
                {amountCents != null && vatMode !== "none" ? (
                  <Text className="px-4 pb-3 text-[13px]" style={{ color: th.sub }}>
                    {vatMode === "exclusive"
                      ? `На счёт придёт ${formatEUR(vatBreakdown.gross)} · налог ${formatEUR(vatBreakdown.vat)}`
                      : `Из них налог ${formatEUR(vatBreakdown.vat)} · вам остаётся ${formatEUR(vatBreakdown.net)}`}
                  </Text>
                ) : null}
              </SectionCard>
            ) : null}

            {/* 5. Счёт — только кассы выбранной команды плюс подключённые
                общие. Способ оплаты выводится из вида счёта: отдельного
                выбора «нал/карта» здесь нет, он повторял бы кассу. */}
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
                      label={a.scope === "company" ? `${a.name} · Общий` : a.name}
                      selected={accountId === a.id}
                      onPress={() => {
                        setAccountTouched(true);
                        const off = accountId === a.id;
                        setAccountId(off ? null : a.id);
                        if (!off) setPayment(paymentMethodForAccountKind(a.kind));
                      }}
                    />
                  ))}
                </ScrollView>
              </SectionCard>
            ) : (
              <SectionCard title="Счёт">
                <Text className="px-4 py-3 text-sm" style={{ color: th.faint }}>
                  {teamId
                    ? "У этой команды нет активного счёта — заведите его в «Счетах»."
                    : "Выберите команду наверху экрана, чтобы появились её кассы."}
                </Text>
              </SectionCard>
            )}

            {/* 6. Заметка */}
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

            {/* 7. Документ, подтверждающий операцию: скан чека или накладная.
                Бухгалтеру нужна не сумма, а бумага под ней. */}
            <SectionCard title="Документ">
              <OperationReceiptRow
                receiptUrl={receiptUrl}
                onPick={setReceiptUrl}
                disabled={busy}
              />
            </SectionCard>

            <View className="h-6" />
          </ScrollView>

          {/* Выбор категории — тот же лист, что и везде. Шестерёнка внутри
              ведёт на страницу категорий: свои категории заводятся там, а не
              выдумываются заметкой в поле «Заметка». */}
          <ValuePickerSheet
            visible={categoryPickerOpen}
            title={isExpense ? "Категория расхода" : "Категория дохода"}
            options={cats.map((c) => ({
              id: c.id,
              label: c.name,
              color: c.color,
            }))}
            selectedId={categoryId}
            emptyLabel={
              isExpense
                ? "Пока нет ни одной категории расходов"
                : "Пока нет ни одной категории доходов"
            }
            onPick={setCategoryId}
            onSettings={() => router.push("/cabinet/categories")}
            settingsLabel="Категории операций"
            onClose={() => setCategoryPickerOpen(false)}
          />

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
