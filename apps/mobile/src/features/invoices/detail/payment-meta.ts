import type { InvoicePaymentLedger } from "@babun/shared/local/finance/invoice-ledger";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import { intlLocale } from "@babun/shared/i18n/runtime";
import { formatInvoiceDate } from "@/lib/paper/format";

/** The grey second line of a payment row on the invoice page. */
export function paymentMeta({
  payment,
  accountName,
  refundable,
  refundInAppointment,
  canOpenAppointment,
  appointmentLookupComplete,
}: {
  payment: InvoicePaymentLedger;
  accountName?: string;
  refundable: number;
  refundInAppointment: boolean;
  canOpenAppointment: boolean;
  appointmentLookupComplete: boolean;
}): string[] {
  const method = paymentMethodLabel(payment.payment_method) || null;
  return [
    // Строка экрана, а не бумаги: язык интерфейса. Умолчание `formatInvoiceDate`
    // («ru-RU») плагин языков не видит — на английском печаталось «5 октября».
    formatInvoiceDate(payment.occurred_on, intlLocale()),
    accountName || "Счёт не указан",
    // Счёт «Наличные» и способ «Наличные» — одно слово дважды подряд.
    method && method !== accountName ? method : null,
    payment.type === "income" && refundable <= 0 ? "возвращён полностью" : null,
    refundInAppointment
      ? canOpenAppointment
        ? "возврат оформляется в заявке"
        : appointmentLookupComplete
          ? "связанная заявка недоступна — возврат здесь заблокирован"
          : "загрузка связанной заявки"
      : null,
  ].filter((value): value is string => Boolean(value));
}

/** Payments still without a receipt are issued one by one, earliest first. */
export function earliestPayment<T extends { created_at: string }>(payments: readonly T[]): T | undefined {
  return [...payments].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
}
