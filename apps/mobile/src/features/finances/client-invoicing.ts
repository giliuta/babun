import { useMemo } from "react";
import type { ClientInvoicing } from "@babun/shared/local/selectors/client-stats";
import { clientInvoicing } from "./client-invoicing-rule";
import { useInvoicePayments, useInvoices } from "./invoices-queries";

/** Тот же набор из кэша инвойсов. Пока они не приехали — `undefined`: долг
 *  считается по записям, как и раньше. */
export function useClientInvoicing(teamId?: string | null): ClientInvoicing | undefined {
  const invoices = useInvoices().data;
  const payments = useInvoicePayments().data;
  return useMemo(
    () => (invoices && payments ? clientInvoicing(invoices, payments, teamId) : undefined),
    [invoices, payments, teamId],
  );
}
