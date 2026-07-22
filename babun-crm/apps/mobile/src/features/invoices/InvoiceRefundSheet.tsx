import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { randomUuid } from "@babun/shared/sync";
import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  parseMoneyAmount,
} from "./format";

const REFUND_MODES = [
  { value: "full", label: "Весь остаток" },
  { value: "partial", label: "Часть" },
] as const;

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Другое",
};

type RefundMode = (typeof REFUND_MODES)[number]["value"];

export function InvoiceRefundSheet({
  visible,
  payment,
  refundable,
  currency,
  businessToday,
  accountName,
  submitting,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  payment: InvoicePaymentLedger | null;
  refundable: number;
  currency: string;
  businessToday: string;
  accountName?: string;
  submitting: boolean;
  onSubmit: (value: {
    paymentId: string;
    draft: {
      request_id: string;
      amount: number;
      occurred_on: string;
      business_today: string;
      original_occurred_on: string;
    };
  }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [mode, setMode] = useState<RefundMode>("full");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(businessToday);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initializedPaymentId = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !payment) {
      initializedPaymentId.current = null;
      return;
    }
    if (initializedPaymentId.current === payment.id) return;
    initializedPaymentId.current = payment.id;
    setMode("full");
    setAmount(String(refundable));
    setOccurredOn(businessToday);
    setRequestId(randomUuid());
    setError(null);
  }, [visible, payment, refundable, businessToday]);

  const parsedAmount = mode === "full" ? refundable : parseMoneyAmount(amount);
  const refundAmount = parsedAmount == null
    ? 0
    : Math.round(parsedAmount * 100) / 100;
  const validAmount = refundAmount > 0 && refundAmount <= refundable;
  const alreadyRefunded = payment
    ? Math.max(0, Math.round((Math.max(0, payment.amount) - refundable) * 100) / 100)
    : 0;

  const submit = async () => {
    if (!payment || !requestId || !validAmount) return;
    setError(null);
    try {
      await onSubmit({
        paymentId: payment.id,
        draft: {
          request_id: requestId,
          amount: refundAmount,
          occurred_on: occurredOn,
          business_today: businessToday,
          original_occurred_on: payment.occurred_on,
        },
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
            accessibilityLabel="Закрыть возврат"
          />
          <View className="rounded-t-3xl px-5 pb-8 pt-5" style={{ backgroundColor: t.surface }}>
            <Text className="text-lg font-bold" style={{ color: t.ink }}>
              Возврат платежа
            </Text>
            <Text className="mt-1 text-3xl font-bold tabular-nums" style={{ color: t.danger }}>
              {formatInvoiceMoney(refundable, currency)}
            </Text>
            <Text className="mt-1 text-sm leading-5" style={{ color: t.sub }}>
              Доступно по платежу от {formatInvoiceDate(payment?.occurred_on ?? null)}
            </Text>

            <View className="mt-4 rounded-xl px-3 py-3" style={{ backgroundColor: t.canvas }}>
              <Text className="text-sm" style={{ color: t.body }}>
                {[accountName || "Счёт платежа", payment?.payment_method
                  ? PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method
                  : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {alreadyRefunded > 0 ? (
                <Text className="mt-1 text-xs tabular-nums" style={{ color: t.sub }}>
                  Уже возвращено {formatInvoiceMoney(alreadyRefunded, currency)}
                </Text>
              ) : null}
            </View>

            <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
              Сумма возврата
            </Text>
            <SegmentedControl options={REFUND_MODES} value={mode} onChange={setMode} />
            {mode === "partial" ? (
              <View
                className="mt-3 flex-row items-center rounded-xl px-3"
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
                  accessibilityLabel="Сумма частичного возврата"
                  className="ml-1 flex-1 text-lg font-semibold tabular-nums"
                  style={{ color: t.ink }}
                />
              </View>
            ) : null}
            {mode === "partial" && amount && !validAmount ? (
              <Text accessibilityRole="alert" className="mt-1 text-xs" style={{ color: t.danger }}>
                {parsedAmount == null
                  ? "Укажите сумму не больше чем с двумя знаками после запятой"
                  : `Сумма должна быть больше нуля и не больше ${formatInvoiceMoney(refundable, currency)}`}
              </Text>
            ) : null}

            <View
              className="mt-4 flex-row items-center justify-between rounded-xl px-3"
              style={{ minHeight: 52, backgroundColor: t.canvas }}
            >
              <View className="flex-1 pr-3">
                <Text className="text-base font-medium" style={{ color: t.ink }}>
                  Дата возврата
                </Text>
                <Text className="mt-0.5 text-xs" style={{ color: t.sub }}>
                  {formatInvoiceDate(occurredOn)}
                </Text>
              </View>
              <DateTimePicker
                value={parseYMD(occurredOn)}
                minimumDate={payment ? parseYMD(payment.occurred_on) : undefined}
                maximumDate={parseYMD(businessToday)}
                mode="date"
                display={Platform.OS === "ios" ? "compact" : "default"}
                locale="ru-RU"
                themeVariant="light"
                accessibilityLabel="Дата возврата"
                onChange={(_, date) => date && setOccurredOn(formatYMD(date))}
              />
            </View>

            {error ? (
              <Text accessibilityRole="alert" className="mt-3 text-center text-sm" style={{ color: t.danger }}>
                {error}
              </Text>
            ) : null}
            <View className="mt-5" style={{ gap: 8 }}>
              <Button
                label={mode === "full" ? "Вернуть весь остаток" : "Оформить возврат"}
                onPress={submit}
                disabled={!payment || !validAmount || submitting}
                loading={submitting}
                variant="secondary"
                tone="danger"
              />
              <Button label="Отмена" variant="secondary" onPress={onClose} disabled={submitting} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
