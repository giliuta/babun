import { useCallback, useMemo } from "react";
import type {
  InvoiceLedger,
  InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { useReceipts } from "@/features/documents/receipts-queries";
import type { AccountWithBalance } from "./accounts";
import type { Period } from "./period";
import { collectDocuments } from "./documents";

// ДОКУМЕНТЫ ПЕРИОДА — ОДИН ИСТОЧНИК ДЛЯ ПЛИТКИ И СПИСКА (аудит 2026-09-29:
// «плитка „Документы 0“, а на вкладке „Чеки“ за этот же месяц 1 чек»).
//
// Плитка считала только инвойсы, ждущие оплату, а список под ней показывал
// все инвойсы и чеки периода — число и строки жили своими правилами и
// расходились. Теперь обе стороны берут один список: сколько строк откроется
// под плиткой, столько она и называет.
export function usePeriodDocuments({
  invoices,
  payments,
  appointments,
  accounts,
  clients,
  clientId,
  teamId,
  period,
  today,
}: {
  invoices: InvoiceLedger[];
  payments: Record<string, InvoicePaymentLedger[]>;
  appointments: Appointment[];
  accounts: AccountWithBalance[];
  clients: Client[];
  clientId?: string | null;
  teamId: string | null;
  period: Period;
  today: string;
}) {
  const receiptsQuery = useReceipts(clientId ? { clientId } : undefined);

  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  // Команда чека — та, за что он выдан: инвойс, запись, а для ручного
  // прихода — счёт, на который легли деньги.
  const invoiceTeam = useMemo(
    () => new Map(invoices.map((i) => [i.id, i.brigade_id])),
    [invoices],
  );
  const appointmentTeam = useMemo(
    () => new Map(appointments.map((a) => [a.id, a.team_id])),
    [appointments],
  );
  const accountTeam = useMemo(
    () =>
      new Map(
        accounts
          .filter((a) => a.scope === "team" && a.brigade_id)
          .map((a) => [a.id, a.brigade_id]),
      ),
    [accounts],
  );
  const receiptTeamId = useCallback(
    (receipt: Receipt): string | null =>
      (receipt.invoice_id ? invoiceTeam.get(receipt.invoice_id) : null) ??
      (receipt.appointment_id
        ? appointmentTeam.get(receipt.appointment_id)
        : null) ??
      (receipt.account_id ? accountTeam.get(receipt.account_id) : null) ??
      null,
    [accountTeam, appointmentTeam, invoiceTeam],
  );

  const receipts = receiptsQuery.data;
  const documents = useMemo(
    () =>
      collectDocuments({
        invoices,
        payments,
        receipts: receipts ?? [],
        clientName: (id) => (id ? (clientName.get(id) ?? null) : null),
        receiptTeamId,
        period: { from: period.from, to: period.to },
        teamId,
        today,
      }),
    [
      clientName,
      invoices,
      payments,
      period.from,
      period.to,
      receiptTeamId,
      receipts,
      teamId,
      today,
    ],
  );

  return { documents, receipts, receiptsQuery };
}
