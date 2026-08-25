import { useEffect, useRef, useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  parseMoneyAmount,
} from "./format";

// ЛИСТ ВОЗВРАТА ПЛАТЕЖА ПО ИНВОЙСУ — канонический BottomSheet. Раньше здесь
// был самописный Modal slide (третий в инвойсном контуре) со своими радиусами.

const REFUND_MODES = [
  { value: "full", label: "Весь остаток" },
  { value: "partial", label: "Часть" },
] as const;

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
  // Родитель обнуляет `payment` в момент закрытия, а BottomSheet ещё 240 мс
  // уезжает вниз — держим последний платёж, чтобы лист не мигал пустотой.
  const lastPayment = useRef<InvoicePaymentLedger | null>(null);
  if (payment) lastPayment.current = payment;
  const shown = payment ?? lastPayment.current;

  useEffect(() => {
    if (!visible || !payment) {
      initializedPaymentId.current = null;
      return;
    }
    if (initializedPaymentId.current === payment.id) return;
    initializedPaymentId.current = payment.id;
    setMode("full");
    // Префилл — грамматикой ввода («116,70»), а не машинным «116.7».
    setAmount(formatMoneyForInput(refundable));
    setOccurredOn(businessToday);
    setRequestId(randomUuid());
    setError(null);
  }, [visible, payment, refundable, businessToday]);

  const parsedAmount = mode === "full" ? refundable : parseMoneyAmount(amount);
  const refundAmount = parsedAmount == null
    ? 0
    : Math.round(parsedAmount * 100) / 100;
  const validAmount = refundAmount > 0 && refundAmount <= refundable;
  const alreadyRefunded = shown
    ? Math.max(0, Math.round((Math.max(0, shown.amount) - refundable) * 100) / 100)
    : 0;

  // Пока возврат уходит, лист не закрывается: человек должен увидеть исход.
  const close = () => {
    if (!submitting) onClose();
  };

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
      haptics.success();
      onClose();
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={close}
      title="Возврат платежа"
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
            label={mode === "full" ? "Вернуть весь остаток" : "Оформить возврат"}
            onPress={submit}
            disabled={!payment || !validAmount || submitting}
            loading={submitting}
            variant="secondary"
            tone="danger"
          />
          <Button label="Отмена" variant="secondary" onPress={onClose} disabled={submitting} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text
          className="text-3xl font-bold"
          style={{ color: t.danger, fontVariant: ["tabular-nums"] }}
        >
          {formatInvoiceMoney(refundable, currency)}
        </Text>
        <Text className="mt-1 text-sm leading-5" style={{ color: t.sub }}>
          Доступно по платежу от {formatInvoiceDate(shown?.occurred_on ?? null)}
        </Text>

        <View
          className="mt-4 px-3 py-3"
          style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
        >
          <Text className="text-sm" style={{ color: t.body }}>
            {[accountName || "Счёт платежа",
              paymentMethodLabel(shown?.payment_method)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {alreadyRefunded > 0 ? (
            <Text
              className="mt-1 text-xs"
              style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
            >
              Уже возвращено {formatInvoiceMoney(alreadyRefunded, currency)}
            </Text>
          ) : null}
        </View>

        <Text
          className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.faint }}
        >
          Сумма возврата
        </Text>
        <SegmentedControl options={REFUND_MODES} value={mode} onChange={setMode} />
        {mode === "partial" ? (
          <View
            className="mt-3 flex-row items-center px-3"
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
              accessibilityLabel="Сумма частичного возврата"
              className="ml-1 flex-1 text-lg font-semibold"
              style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
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
          className="mt-4 flex-row items-center justify-between px-3"
          style={{
            minHeight: 52,
            borderRadius: t.radius.input,
            backgroundColor: t.fill,
          }}
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
            minimumDate={shown ? parseYMD(shown.occurred_on) : undefined}
            maximumDate={parseYMD(businessToday)}
            mode="date"
            display={Platform.OS === "ios" ? "compact" : "default"}
            locale="ru-RU"
            themeVariant="light"
            accessibilityLabel="Дата возврата"
            onChange={(_, date) => date && setOccurredOn(formatYMD(date))}
          />
        </View>
      </View>
    </BottomSheet>
  );
}
