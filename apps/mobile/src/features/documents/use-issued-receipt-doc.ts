import type { Appointment } from "@babun/shared/local/appointments";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { InvoiceLanguage } from "@/features/invoices/dictionary";
import { isUiLocale } from "@babun/shared/i18n/locales";
import { useInvoice } from "@/features/invoices/queries";
import type { InvoiceLedgerWithLines } from "@babun/shared/local/finance/invoice-ledger";
import {
  buildReceiptDocument,
  receiptCoversFullAmount,
  receiptLinesFromAppointment,
  receiptLinesFromInvoice,
  type ReceiptDocument,
  type ReceiptLineItemsInput,
} from "./receipt-document";
import { useReceiptAppointment } from "./receipts-queries";

// БУМАГА ВЫПИСАННОГО ЧЕКА — ОДНО ПРАВИЛО НА СТРАНИЦУ ЧЕКА И PDF.
//
// Свой снимок строк сильнее любого источника (чеки с 20.09). У старых чеков
// перечень собирается из инвойса или записи за спиной проводки — и только
// когда чек закрывает источник ЦЕЛИКОМ: «Итого работ €250» рядом с
// «Получено €100» без слова об остатке была бы неправдой.
export function useIssuedReceiptDoc(receipt: Receipt | null): {
  doc: ReceiptDocument | null;
  lineItems: ReceiptLineItemsInput | undefined;
  language: InvoiceLanguage;
  invoiceNumber: string | null;
  appointment: Appointment | null;
  /** Инвойс оплаты — плашкой на странице чека. */
  invoice: InvoiceLedgerWithLines | null;
  /** Источник строк ещё едет — PDF ждёт его, а не печатается наполовину. */
  linesLoading: boolean;
} {
  const invoiceId = receipt?.invoice_id ?? undefined;
  const invoiceQuery = useInvoice(invoiceId);
  const appointmentQuery = useReceiptAppointment(receipt?.appointment_id ?? null);
  const appointment = appointmentQuery.data ?? null;

  if (!receipt) {
    return { doc: null, lineItems: undefined, language: "en", invoiceNumber: null, appointment, invoice: null, linesLoading: false };
  }
  const linesLoading =
    !receipt.lines &&
    ((!!invoiceId && invoiceQuery.isLoading) ||
      (!invoiceId && !!receipt.appointment_id && appointmentQuery.isLoading));

  let lineItems: ReceiptLineItemsInput | undefined;
  if (receipt.lines && receipt.lines.length > 0) {
    lineItems = { lines: receipt.lines };
  } else if (invoiceId && invoiceQuery.data) {
    if (receiptCoversFullAmount(receipt.amount, invoiceQuery.data.total)) {
      lineItems = receiptLinesFromInvoice(invoiceQuery.data.lines);
    }
  } else if (appointment) {
    if (receiptCoversFullAmount(receipt.amount, appointment.total_amount)) {
      lineItems = receiptLinesFromAppointment(appointment);
    }
  }
  // Как у черновика: язык инвойса, без инвойса — английский (владелец 04.10).
  const paperLanguage = invoiceQuery.data?.language;
  const language: InvoiceLanguage = isUiLocale(paperLanguage) ? paperLanguage : "en";
  const invoiceNumber = invoiceQuery.data?.number ?? null;
  return {
    doc: buildReceiptDocument(receipt, lineItems, language, invoiceNumber),
    lineItems,
    language,
    invoiceNumber,
    appointment,
    invoice: invoiceQuery.data ?? null,
    linesLoading,
  };
}
