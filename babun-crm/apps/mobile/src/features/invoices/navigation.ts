import { useRouter, type Href } from "expo-router";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

export function useInvoiceNavigation() {
  const router = useRouter();

  const openInvoices = () => router.push("/invoices" as Href);

  const openTransactionInvoice = (transaction: FinanceTransaction) => {
    if (transaction.invoice_id) {
      router.push(`/invoices/${transaction.invoice_id}` as Href);
      return;
    }
    router.push({
      pathname: "/invoices/new",
      params: {
        transactionId: transaction.id,
        clientId: transaction.client_id ?? undefined,
        appointmentId: transaction.appointment_id ?? undefined,
        teamId: transaction.team_id ?? undefined,
        amount: String(Math.abs(transaction.amount)),
        title: transaction.notes || "Услуги",
        issuedOn: transaction.occurred_on,
      },
    } as unknown as Href);
  };

  return { openInvoices, openTransactionInvoice };
}
