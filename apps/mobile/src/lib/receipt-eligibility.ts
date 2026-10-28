import {
  calculateInvoicePaymentRefundable,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";

// КОГДА ЧЕК МОЖНО ВЫПИСАТЬ — ОДНО ПРАВИЛО НА ВСЕ ДВЕРИ: кнопка внизу инвойса,
// пункт меню в «Документах», ссылка `?action=receipt` и сам составитель чека.
//
// Сервер выпускает чек на ПРИНЯТУЮ оплату человека: у оплаты без клиента он
// отвечает «чек не нужен», на возвращённую целиком — отказывает. Предлагать
// такое действие значит вести в тупик: кнопка нажимается, а чек не выходит.
// Поэтому там, где чек невозможен, его и не предлагают, а человеку, пришедшему
// ссылкой, называют настоящую причину.

type ReceiptRefusal = "no-client" | "not-an-invoice" | "refunded" | "nothing";

/** Платежи инвойса, на которые чек ещё можно выписать: приход, без чека, не
 *  возвращённый целиком. */
export function paymentsAwaitingReceipt(
  payments: readonly InvoicePaymentLedger[],
  receiptTransactionIds: ReadonlySet<string>,
): InvoicePaymentLedger[] {
  return payments.filter(
    (payment) =>
      payment.type === "income" &&
      !receiptTransactionIds.has(payment.id) &&
      calculateInvoicePaymentRefundable(payment, payments) > 0,
  );
}

/** Почему чек по инвойсу выписать нельзя; `null` — можно. */
export function receiptRefusal(input: {
  invoice: { client_id: string | null; status: string; kind?: string | null };
  payments: readonly InvoicePaymentLedger[];
  receiptTransactionIds: ReadonlySet<string>;
}): ReceiptRefusal | null {
  const { invoice, payments, receiptTransactionIds } = input;
  if (
    (invoice.kind ?? "invoice") !== "invoice" ||
    invoice.status === "void" ||
    invoice.status === "cancelled"
  ) {
    return "not-an-invoice";
  }
  if (!invoice.client_id) return "no-client";
  if (paymentsAwaitingReceipt(payments, receiptTransactionIds).length > 0) return null;
  const refundedWithoutReceipt = payments.some(
    (payment) => payment.type === "income" && !receiptTransactionIds.has(payment.id),
  );
  return refundedWithoutReceipt ? "refunded" : "nothing";
}

/** Слова причины — для плашки и сообщения. */
export function receiptRefusalText(refusal: ReceiptRefusal): string {
  switch (refusal) {
    case "no-client":
      return "У инвойса нет клиента, а чек выписывается на человека. Инвойс с оплатой не меняется: отмените его и выставьте новый на клиента.";
    case "not-an-invoice":
      return "Чек выписывается только на действующий инвойс.";
    case "refunded":
      return "Оплата возвращена целиком — чек на неё не выписывается.";
    default:
      return "По этому инвойсу нет оплаты без чека — выписывать нечего.";
  }
}

/** Оплата возвращена целиком (по журналу платежей её инвойса). Пока журнала
 *  нет или в нём нет этой оплаты — `false`: решает сервер. */
export function paymentFullyRefunded(
  transactionId: string,
  payments: readonly InvoicePaymentLedger[] | undefined,
): boolean {
  const payment = payments?.find((row) => row.id === transactionId);
  return !!payments && !!payment && calculateInvoicePaymentRefundable(payment, payments) <= 0;
}
