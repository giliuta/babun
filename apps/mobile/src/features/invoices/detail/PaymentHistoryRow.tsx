import { Pressable, Text, View } from "react-native";
import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney } from "../format";
import { paymentMeta } from "./payment-meta";

export function PaymentHistoryRow({
  payment,
  accountName,
  currency,
  refundable,
  refundInAppointment,
  appointmentLookupComplete,
  onOpenAppointment,
  onRefund,
}: {
  payment: InvoicePaymentLedger;
  accountName?: string;
  currency: string;
  refundable: number;
  refundInAppointment: boolean;
  appointmentLookupComplete: boolean;
  onOpenAppointment?: () => void;
  onRefund?: () => void;
}) {
  const t = useThemeColors();
  const isRefund = payment.type === "refund";
  const meta = paymentMeta({
    payment,
    accountName,
    refundable,
    refundInAppointment,
    canOpenAppointment: !!onOpenAppointment,
    appointmentLookupComplete,
  });
  return (
    <View className="flex-row items-center px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="text-[15px] font-medium" style={{ color: t.ink }}>
          {isRefund ? "Возврат" : "Платёж"}
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: t.sub }} numberOfLines={2}>
          {meta.join(" · ")}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-base font-semibold"
          style={{ color: isRefund ? t.danger : t.success, fontVariant: ["tabular-nums"] }}
        >
          {isRefund ? "−" : ""}{formatInvoiceMoney(Math.abs(payment.amount), currency)}
        </Text>
        {onOpenAppointment ? (
          <Pressable
            onPress={onOpenAppointment}
            accessibilityRole="button"
            accessibilityLabel="Открыть заявку для возврата оплаты"
            className="mt-1 min-h-11 justify-center rounded-full px-3 active:opacity-60"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.accent }}>
              Открыть заявку
            </Text>
          </Pressable>
        ) : onRefund ? (
          <Pressable
            onPress={onRefund}
            accessibilityRole="button"
            accessibilityLabel={`Оформить возврат по платежу ${formatInvoiceMoney(Math.abs(payment.amount), currency)}`}
            className="mt-1 min-h-11 justify-center rounded-full px-3 active:opacity-60"
            style={{ backgroundColor: t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.danger }}>
              Вернуть
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
