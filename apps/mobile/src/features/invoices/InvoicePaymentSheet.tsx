import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import {
  accountKindForPaymentMethod,
  accountServesTeam,
} from "@babun/shared/local/finance/integrity";
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ValueOptionList } from "@/components/ui/ValuePickerSheet";
import type { AccountWithBalance } from "@/features/finances/accounts";
import { accountPickerLabel } from "@/features/finances/account-ui";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceDate, formatInvoiceMoney, parseMoneyAmount } from "./format";

// ЛИСТ «ПРИНЯТЬ ОПЛАТУ» — момент рождения чека, поэтому жанр строгий:
// канонический BottomSheet (скрим fade + пружина), список счетов — общий
// ValueOptionList. Раньше здесь был самописный Modal slide со своей вёрсткой
// строк — прямое нарушение «один дизайн на все списки».

const METHODS = PAYMENT_METHODS.map((value) => ({
  value,
  label: PAYMENT_METHOD_LABEL[value],
}));

const EMPTY_ACCOUNT_BY_METHOD: Record<PaymentMethod, string> = {
  cash: "Нет активной кассы для наличного платежа.",
  card: "Нет активного карточного счёта.",
  transfer: "Нет активного банковского счёта для перевода.",
  other: "Нет активного счёта типа «Другое».",
};

function accountsForPaymentMethod(
  accounts: readonly AccountWithBalance[],
  brigadeId: string | null,
  method: PaymentMethod,
): AccountWithBalance[] {
  const kind = accountKindForPaymentMethod(method);
  // Порядок простой: счёт принадлежит одной команде, делить список на «свои» и
  // «общие» больше не на что (владелец 2026-08-15).
  return accounts
    .filter(
      (account) =>
        account.is_active &&
        account.kind === kind &&
        (brigadeId == null || accountServesTeam(account, brigadeId)),
    )
    .sort((a, b) => a.position - b.position);
}

function defaultPaymentMethod(
  accounts: readonly AccountWithBalance[],
  brigadeId: string | null,
): PaymentMethod {
  // Инвойс обычно оплачивают переводом. Если банковского счёта нет,
  // начинаем с первого реально доступного способа, а не с тупика.
  for (const method of ["transfer", "cash", "card", "other"] as const) {
    if (accountsForPaymentMethod(accounts, brigadeId, method).length > 0) {
      return method;
    }
  }
  return "transfer";
}

export function InvoicePaymentSheet({
  visible,
  total,
  paid,
  remaining,
  currency,
  businessToday,
  brigadeId,
  accounts,
  submitting,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  total: number;
  paid: number;
  remaining: number;
  currency: string;
  businessToday: string;
  brigadeId: string | null;
  accounts: AccountWithBalance[];
  submitting: boolean;
  onSubmit: (value: {
    request_id: string;
    amount: number;
    account_id: string;
    payment_method: PaymentMethod;
    occurred_on: string;
    business_today: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(businessToday);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initializedForOpen = useRef(false);

  useEffect(() => {
    if (!visible) {
      initializedForOpen.current = false;
      return;
    }
    if (initializedForOpen.current) return;
    initializedForOpen.current = true;
    const initialMethod = defaultPaymentMethod(accounts, brigadeId);
    const matching = accountsForPaymentMethod(accounts, brigadeId, initialMethod)[0];
    setMethod(initialMethod);
    setAccountId(matching?.id ?? null);
    // Префилл — той же грамматикой, что набирает человек: «116,70», а не
    // машинное «116.7» с точкой (как в TransferSheet).
    setAmount(formatMoneyForInput(remaining));
    setOccurredOn(businessToday);
    setRequestId(randomUuid());
    setError(null);
  }, [visible, accounts, brigadeId, remaining, businessToday]);

  const activeAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          (brigadeId == null || accountServesTeam(account, brigadeId)),
      ),
    [accounts, brigadeId],
  );
  const compatibleAccounts = useMemo(
    () => accountsForPaymentMethod(accounts, brigadeId, method),
    [accounts, brigadeId, method],
  );

  useEffect(() => {
    if (!visible) return;
    setAccountId((current) =>
      current && compatibleAccounts.some((account) => account.id === current)
        ? current
        : (compatibleAccounts[0]?.id ?? null),
    );
    setError(null);
  }, [visible, method, compatibleAccounts]);

  const parsedAmount = parseMoneyAmount(amount);
  const paymentAmount = parsedAmount ?? 0;
  const validAmount = paymentAmount > 0 && paymentAmount <= remaining;

  // Пока платёж уходит, лист не закрывается ни скримом, ни свайпом: человек
  // должен увидеть исход — ушли деньги или нет.
  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (!accountId || !requestId || !validAmount) return;
    setError(null);
    try {
      const account = compatibleAccounts.find((item) => item.id === accountId);
      if (!account) {
        setError("Выберите совместимый счёт для этого способа оплаты.");
        return;
      }
      await onSubmit({
        request_id: requestId,
        amount: paymentAmount,
        account_id: accountId,
        payment_method: method,
        occurred_on: occurredOn,
        business_today: businessToday,
      });
      haptics.success();
      onClose();
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  const eyebrowStyle = {
    marginTop: 20,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: t.faint,
  } as const;

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={close}
      title="Оплата инвойса"
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {error ? (
            <Text
              accessibilityRole="alert"
              className="text-center text-sm"
              style={{ color: t.danger }}
            >
              {error}
            </Text>
          ) : null}
          <Button
            label="Подтвердить оплату"
            onPress={submit}
            disabled={!accountId || !validAmount || submitting}
            loading={submitting}
          />
          <Button label="Отмена" variant="secondary" onPress={onClose} disabled={submitting} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text
          className="text-3xl font-bold"
          style={{ color: t.success, fontVariant: ["tabular-nums"] }}
        >
          {formatInvoiceMoney(remaining, currency)}
        </Text>
        <Text
          className="mt-1 text-sm"
          style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
        >
          Оплачено {formatInvoiceMoney(paid, currency)} из {formatInvoiceMoney(total, currency)}
        </Text>

        {activeAccounts.length === 0 ? (
          <Text className="my-5 text-sm leading-5" style={{ color: t.sub }}>
            Сначала создайте активный финансовый счёт для этой команды. Без него
            оплата не попадёт в остатки и отчёт.
          </Text>
        ) : (
          <>
            <Text style={eyebrowStyle}>Сумма платежа</Text>
            <View
              className="flex-row items-center px-3"
              style={{
                minHeight: 48,
                borderRadius: t.radius.input,
                backgroundColor: t.fill,
              }}
            >
              <Text className="text-base" style={{ color: t.sub }}>{currency}</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                keyboardAppearance="light"
                placeholder="0"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                accessibilityLabel="Сумма платежа"
                className="ml-1 flex-1 text-lg font-semibold"
                style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
              />
            </View>
            {amount && !validAmount ? (
              <Text className="mt-1 text-xs" style={{ color: t.danger }}>
                {parsedAmount == null
                  ? "Укажите сумму не больше чем с двумя знаками после запятой"
                  : `Сумма должна быть больше нуля и не больше ${formatInvoiceMoney(remaining, currency)}`}
              </Text>
            ) : null}
            <View
              className="mt-4 flex-row items-center justify-between px-3"
              style={{
                minHeight: 52,
                borderRadius: t.radius.input,
                backgroundColor: t.fill,
              }}
            >
              <View className="flex-1 pr-3">
                <Text className="text-base font-medium" style={{ color: t.ink }}>
                  Дата платежа
                </Text>
                <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
                  {formatInvoiceDate(occurredOn)}
                </Text>
              </View>
              <DateTimePicker
                value={parseYMD(occurredOn)}
                maximumDate={parseYMD(businessToday)}
                mode="date"
                display={Platform.OS === "ios" ? "compact" : "default"}
                locale="ru-RU"
                themeVariant="light"
                accessibilityLabel="Дата платежа"
                onChange={(_, date) => date && setOccurredOn(formatYMD(date))}
              />
            </View>
            <Text style={eyebrowStyle}>Способ оплаты</Text>
            <SegmentedControl options={METHODS} value={method} onChange={setMethod} />
            <Text style={eyebrowStyle}>Зачислить на счёт</Text>
            {compatibleAccounts.length === 0 ? (
              <Text
                accessibilityRole="alert"
                className="px-3 py-3 text-sm leading-5"
                style={{
                  color: t.sub,
                  borderRadius: t.radius.input,
                  backgroundColor: t.fill,
                }}
              >
                {EMPTY_ACCOUNT_BY_METHOD[method]} Создайте его в разделе
                «Финансы → Счета» или выберите другой способ оплаты.
              </Text>
            ) : (
              <ValueOptionList
                options={compatibleAccounts.map((account) => ({
                  id: account.id,
                  // Одна подпись на строку и на озвучку: расходиться им негде.
                  label: accountPickerLabel(account),
                  value: formatInvoiceMoney(account.balance, currency),
                }))}
                selectedId={accountId}
                // Оплата без счёта невозможна — повторный тап выбор не снимает.
                clearable={false}
                onPick={setAccountId}
              />
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}
