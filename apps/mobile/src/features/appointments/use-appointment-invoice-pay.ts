import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import { getAppointment } from "@babun/shared/db/repositories/appointments";
import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { randomUuid } from "@babun/shared/sync";

import {
  useInvoiceAppointmentMoney,
  useInvoicePayments,
  useRecordInvoicePayment,
} from "@/features/finances/invoices-queries";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { finishPayAttempt, payAttempt, payAttemptKey, type PayAttempt } from "./invoice-pay-request";

// ДЕНЬГИ ЗАПИСИ С ИНВОЙСОМ — В ИНВОЙС (иначе после предоплаты и чека инвойс
// оставался бы неоплаченным — расхождение во всех слоях финансов). Пока по записи есть
// выставленный неоплаченный инвойс, счёт клиенту — он: к оплате — его
// остаток, плитка счёта записывает платёж ИНВОЙСА (`record_invoice_payment`),
// сервер закрывает им и запись (`settle_appointment_from_invoice_payment`), а
// чек выписывается на этот платёж. Прямая оплата записи сервер в таком случае
// отклоняет (20261004224517).

const METHOD_BY_KIND: Record<string, "cash" | "card" | "transfer" | "other"> = {
  cash: "cash",
  card: "card",
  bank: "transfer",
};

export function useAppointmentInvoicePay(
  invoice: InvoiceLedger | null,
  appointmentId: string | null,
) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const paymentsQuery = useInvoicePayments();
  // Остаток бумаги — за вычетом денег, которые запись приняла мимо инвойса.
  const appointmentMoney = useInvoiceAppointmentMoney().data;
  const record = useRecordInvoicePayment(invoice?.id ?? "");
  // Потерянный ответ не должен стать вторым платежом: id держится до успеха.
  const attempt = useRef<PayAttempt | null>(null);
  const open = !!invoice && (invoice.kind ?? "invoice") === "invoice" && invoice.status === "issued";
  const settlement =
    open && invoice
      ? calculateInvoiceSettlement(
          invoice,
          paymentsQuery.data?.[invoice.id] ?? [],
          appointmentMoney?.[invoice.id] ?? 0,
        )
      : null;
  const remainingCents = settlement ? Math.round(settlement.remaining * 100) : 0;

  const pay = async (input: {
    accountId: string;
    accountKind: string;
    amountCents: number;
    businessToday: string;
  }): Promise<Appointment | null> => {
    if (!invoice) return null;
    const { id: requestId, occurredOn } = payAttempt(
      attempt,
      payAttemptKey({ invoiceId: invoice.id, accountId: input.accountId, amountCents: input.amountCents }),
      randomUuid,
      input.businessToday,
    );
    await record.mutateAsync({
      request_id: requestId,
      amount: input.amountCents / 100,
      account_id: input.accountId,
      payment_method: METHOD_BY_KIND[input.accountKind] ?? "other",
      occurred_on: occurredOn,
      business_today: input.businessToday,
    });
    finishPayAttempt(attempt);
    // Запись закрыл сервер зачётом — забираем её свежей.
    void qc.invalidateQueries({ queryKey: ["appointments"] });
    void qc.invalidateQueries({ queryKey: ["appointment-ledger"] });
    if (!appointmentId || !tenantId) return null;
    return getAppointment(supabase, appointmentId, tenantId);
  };

  return {
    /** Выставлен и не оплачен — деньги записи идут в него. */
    open: open && remainingCents > 0,
    /** Ещё не знаем остатка — плитки ждут, а не платят мимо. */
    loading: open && paymentsQuery.isPending,
    number: invoice?.number ?? "",
    remainingCents,
    busy: record.isPending,
    pay,
  };
}
