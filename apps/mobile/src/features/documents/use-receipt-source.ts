import { useEffect, useRef } from "react";
import { newCustomServiceId, type AppointmentService } from "@babun/shared/local/appointments";
import { lineTotal } from "@babun/shared/local/finance/appointment-calc";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { useInvoice } from "@/features/invoices/queries";
import type { InvoiceLanguage } from "@/features/invoices/dictionary";
import type { ReceiptDraftState } from "./ReceiptComposer";
import { paymentReceiptLines } from "./receipt-for-payment";
import {
  useReceipt,
  useReceiptAppointment,
  useReceiptTransaction,
} from "./receipts-queries";

// ОТКУДА ЧЕК БЕРЁТ СЕБЯ (владелец 2026-10-03/04): с нуля; на принятую оплату
// (`transactionId` — значок чека в записи, «Выписать чек» инвойса); правка
// выписанного (`receiptId` — «Изменить» в листе чека, тот же номер). В двух
// последних случаях деньги уже в журнале: клиент, счёт и сумма — от оплаты.

export type ReceiptSourceMode = "new" | "payment" | "edit";

export function useReceiptSource(
  params: { transactionId?: string; receiptId?: string },
  change: (next: Partial<ReceiptDraftState>) => void,
): {
  mode: ReceiptSourceMode;
  tx: FinanceTransaction | null;
  editing: Receipt | null;
  invoiceNumber: string | null;
  /** Чек по инвойсу подписан реквизитами инвойса — их не выбирают. */
  invoiceCompanyId: string | null;
  /** Язык бумаги — язык инвойса оплаты (чек обязан говорить тем же языком,
   *  что выйдет: предпросмотр был русским, выписанный — английским, 04.10). */
  language: InvoiceLanguage;
  ready: boolean;
} {
  const editing = useReceipt(params.receiptId).data ?? null;
  const txId = params.transactionId ?? editing?.transaction_id ?? null;
  const tx = useReceiptTransaction(txId).data ?? null;
  const invoice = useInvoice(tx?.invoice_id ?? undefined);
  const appointment = useReceiptAppointment(tx && !tx.invoice_id ? tx.appointment_id : null);
  const mode: ReceiptSourceMode = params.receiptId ? "edit" : params.transactionId ? "payment" : "new";
  const ready =
    mode === "new" ||
    (!!tx &&
      (mode !== "edit" || !!editing) &&
      (!tx.invoice_id || !invoice.isLoading) &&
      Boolean(tx.invoice_id || !tx.appointment_id || !appointment.isLoading));
  const invoiceRow = invoice.data ?? null;
  const invoiceNumber = invoiceRow?.number ?? null;
  const invoiceCompanyId = invoiceRow?.company_id ?? null;

  const seeded = useRef(false);
  useEffect(() => {
    if (mode === "new" || !ready || !tx || seeded.current) return;
    seeded.current = true;
    const base = {
      clientId: tx.client_id,
      accountId: tx.account_id,
      teamId: tx.team_id ?? null,
    };
    if (mode === "edit" && editing) {
      change({
        ...base,
        companyId: editing.company_id ?? null,
        date: editing.issued_on,
        locationId: editing.location_id ?? null,
        clientRequisitesId: editing.client_requisites_id ?? null,
        lines: (editing.lines ?? []).map(snapshotLine),
      });
      return;
    }
    change({
      ...base,
      companyId: invoiceCompanyId,
      date: tx.occurred_on,
      // Объект — тот, за который работа: объект инвойса, иначе записи.
      locationId: invoiceRow?.location_id ?? appointment.data?.location_id ?? null,
      lines: paymentReceiptLines(
        tx,
        { invoiceLines: invoiceRow?.lines ?? null, appointment: appointment.data ?? null },
        invoiceNumber ? `Оплата по инвойсу ${invoiceNumber}` : "Оплата",
      ),
    });
  }, [mode, ready, tx, editing, invoiceRow, invoiceNumber, invoiceCompanyId, appointment.data, change]);

  // Бумага — на языке инвойса; чек без инвойса — по-английски (владелец
  // 04.10: «делай пока что всё на английском»).
  const language: InvoiceLanguage = invoiceRow?.language === "ru" ? "ru" : "en";
  return { mode, tx, editing, invoiceNumber, invoiceCompanyId, language, ready };
}

/** Строка снимка выписанного чека — снова строка блока «Услуги». */
function snapshotLine(line: {
  name: string;
  qty: number;
  unit: string | null;
  unitPrice: number;
}): AppointmentService {
  const next: AppointmentService = {
    serviceId: newCustomServiceId(),
    quantity: line.qty,
    pricePerUnit: line.unitPrice,
    originalPrice: line.unitPrice,
    totalPrice: 0,
    duration: 0,
    serviceName: line.name,
    unit: line.unit,
  };
  return { ...next, totalPrice: lineTotal(next) };
}
