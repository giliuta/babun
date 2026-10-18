import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import type { ClientInvoicing } from "@babun/shared/local/selectors/client-stats";

// ДОЛГ КЛИЕНТА И ИНВОЙСЫ — ОДНИМ ПРАВИЛОМ С «ФИНАНСАМИ». Плитка «Долги» и
// день календаря выкидывают работу под живым инвойсом и считают долгом
// остаток самого инвойса (`use-home-debts.ts`, `debt-rows.ts`). Карточка
// клиента, «Неоплаченные» и «Аналитика» считали только записи: после
// частичной кредит-ноты к оплаченному инвойсу у записи навсегда висел долг на
// сумму ноты, а у неоплаченного инвойса с нотой — вся его сумма.

/** Остаток живых инвойсов: по записи, а у инвойса без записи — по клиенту. */
export function clientInvoicing(
  invoices: readonly InvoiceLedger[],
  payments: Readonly<Record<string, InvoicePaymentLedger[]>>,
  /** Срез команды: инвойс без записи считается только у своей команды. */
  teamId?: string | null,
): ClientInvoicing {
  const byAppointment = new Map<string, number>();
  const unlinkedByClient = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, amount: number) =>
    map.set(key, (Math.round((map.get(key) ?? 0) * 100) + Math.round(amount * 100)) / 100);
  for (const inv of invoices) {
    if (inv.kind === "credit_note" || inv.status === "void" || inv.status === "cancelled") continue;
    const remaining = Math.max(0, calculateInvoiceSettlement(inv, payments[inv.id] ?? []).remaining);
    if (inv.appointment_id) add(byAppointment, inv.appointment_id, remaining);
    else if (inv.client_id && remaining > 0 && (teamId == null || inv.brigade_id === teamId)) {
      add(unlinkedByClient, inv.client_id, remaining);
    }
  }
  return { byAppointment, unlinkedByClient };
}
