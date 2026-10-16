import { useMemo } from "react";
import { invoicedAppointmentIds } from "@babun/shared/local/finance/invoice-ledger";
import { useInvoices } from "@/features/finances/invoices-queries";

/** Записи под живым инвойсом — тем же правилом, что плитка «Долги» в
 *  «Финансах»: долг дня календаря обязан совпадать с долгом «Финансов». */
export function useInvoicedAppointmentSet(): ReadonlySet<string> {
  const invoices = useInvoices().data;
  return useMemo(() => invoicedAppointmentIds(invoices ?? []), [invoices]);
}
