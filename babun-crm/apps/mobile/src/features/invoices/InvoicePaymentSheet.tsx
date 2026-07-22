import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check } from "lucide-react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { PaymentMethod } from "@babun/shared/local/finance/transaction";
import { accountKindForPaymentMethod } from "@babun/shared/local/finance/integrity";
import { randomUuid } from "@babun/shared/sync";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ICON } from "@/components/ui/tokens";
import type { AccountWithBalance } from "@/features/finances/accounts";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceDate, formatInvoiceMoney, parseMoneyAmount } from "./format";

const METHODS = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "transfer", label: "Перевод" },
  { value: "other", label: "Другое" },
] as const;

type InvoicePaymentMethod = (typeof METHODS)[number]["value"];

const EMPTY_ACCOUNT_BY_METHOD: Record<InvoicePaymentMethod, string> = {
  cash: "Нет активной кассы для наличного платежа.",
  card: "Нет активного карточного счёта.",
  transfer: "Нет активного банковского счёта для перевода.",
  other: "Нет активного счёта типа «Другое».",
};

function accountsForPaymentMethod(
  accounts: readonly AccountWithBalance[],
  brigadeId: string | null,
  method: InvoicePaymentMethod,
): AccountWithBalance[] {
  const kind = accountKindForPaymentMethod(method);
  return accounts.filter(
    (account) =>
      account.is_active &&
      account.kind === kind &&
      (brigadeId == null || account.brigade_id === brigadeId),
  );
}

function defaultPaymentMethod(
  accounts: readonly AccountWithBalance[],
  brigadeId: string | null,
): InvoicePaymentMethod {
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
  const [method, setMethod] = useState<InvoicePaymentMethod>("transfer");
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
    setAmount(String(remaining));
    setOccurredOn(businessToday);
    setRequestId(randomUuid());
    setError(null);
  }, [visible, accounts, brigadeId, remaining, businessToday]);

  const activeAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.is_active &&
          (brigadeId == null || account.brigade_id === brigadeId),
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
  const paymentAmount = parsedAmount == null ? 0 : Math.round(parsedAmount * 100) / 100;
  const validAmount = paymentAmount > 0 && paymentAmount <= remaining;

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
      onClose();
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
          <Pressable
            className="flex-1"
            onPress={submitting ? undefined : onClose}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          />
          <View className="rounded-t-3xl px-5 pb-8 pt-5" style={{ backgroundColor: t.surface }}>
          <Text className="text-lg font-bold" style={{ color: t.ink }}>Оплата инвойса</Text>
          <Text className="mt-1 text-3xl font-bold tabular-nums" style={{ color: t.success }}>
            {formatInvoiceMoney(remaining, currency)}
          </Text>
          <Text className="mt-1 text-sm" style={{ color: t.sub }}>
            Оплачено {formatInvoiceMoney(paid, currency)} из {formatInvoiceMoney(total, currency)}
          </Text>

          {activeAccounts.length === 0 ? (
            <Text className="my-5 text-sm leading-5" style={{ color: t.sub }}>
              Сначала создайте активный финансовый счёт для этой команды. Без него оплата не попадёт в остатки и отчёт.
            </Text>
          ) : (
            <>
              <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
                Сумма платежа
              </Text>
              <View
                className="flex-row items-center rounded-xl px-3"
                style={{ minHeight: 48, backgroundColor: t.fill }}
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
                  className="ml-1 flex-1 text-lg font-semibold tabular-nums"
                  style={{ color: t.ink }}
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
                className="mt-4 flex-row items-center justify-between rounded-xl px-3"
                style={{ minHeight: 52, backgroundColor: t.canvas }}
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
              <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
                Способ оплаты
              </Text>
              <SegmentedControl options={METHODS} value={method} onChange={setMethod} />
              <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
                Зачислить на счёт
              </Text>
              {compatibleAccounts.length === 0 ? (
                <Text
                  accessibilityRole="alert"
                  className="rounded-xl px-3 py-3 text-sm leading-5"
                  style={{ color: t.sub, backgroundColor: t.fill }}
                >
                  {EMPTY_ACCOUNT_BY_METHOD[method]} Создайте его в разделе «Финансы → Счета» или выберите другой способ оплаты.
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 210 }} className="overflow-hidden rounded-xl">
                  {compatibleAccounts.map((account, index) => (
                    <Pressable
                      key={account.id}
                      onPress={() => setAccountId(account.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={`${account.name}, ${formatInvoiceMoney(account.balance, currency)}`}
                      accessibilityState={{ selected: account.id === accountId }}
                      className="flex-row items-center px-3 py-3 active:opacity-60"
                      style={{
                        minHeight: 50,
                        backgroundColor: t.canvas,
                        borderTopWidth: index ? 1 : 0,
                        borderTopColor: t.separator,
                      }}
                    >
                      <View className="flex-1">
                        <Text className="text-base font-medium" style={{ color: t.ink }}>{account.name}</Text>
                        <Text className="text-xs" style={{ color: t.sub }}>{formatInvoiceMoney(account.balance, currency)}</Text>
                      </View>
                      {account.id === accountId ? <Check color={t.accent} size={ICON.sm} /> : null}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          )}

          {error ? <Text className="mt-3 text-center text-sm" style={{ color: t.danger }}>{error}</Text> : null}
          <View className="mt-5" style={{ gap: 8 }}>
            <Button
              label="Подтвердить оплату"
              onPress={submit}
              disabled={!accountId || !validAmount || submitting}
              loading={submitting}
            />
            <Button label="Отмена" variant="secondary" onPress={onClose} disabled={submitting} />
          </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
