import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { useInvoices } from "@/features/invoices/queries";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// СКОЛЬКО ПО ЧЕКУ ВЕРНУЛИ И СКОЛЬКО ИЗ ЭТОГО ЕЩЁ БЕЗ ДОКУМЕНТА (04.10). Деньги
// возвращают разными дверями (форма возврата, отмена визита, запись,
// операция), а документ один — кредит-нота к чеку. Чек оплаты инвойса
// отменяется нотой к инвойсу — здесь не считается.
export function useReceiptRefunds(receipt: Receipt | null) {
  const tenantId = useTenantId();
  const txId = receipt?.transaction_id ?? null;
  const refunded = useQuery({
    queryKey: ["transactions", tenantId, "refunds-of", txId],
    enabled: !!tenantId && !!txId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("amount")
        .eq("tenant_id", tenantId as string)
        .eq("refund_of_id", txId as string)
        .eq("type", "refund");
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
    },
  });
  const invoices = useInvoices();
  const notes = (invoices.data ?? []).filter(
    (note) =>
      note.kind === "credit_note" &&
      !!receipt &&
      (note.credit_note_of_receipt_id === receipt.id ||
        (!!receipt.invoice_id && note.credit_note_of_id === receipt.invoice_id)),
  );
  const refundedAmount = refunded.data ?? 0;
  const covered = notes
    .filter((note) => note.credit_note_of_receipt_id === receipt?.id)
    .reduce((sum, note) => sum - note.total, 0);
  const uncovered =
    receipt && !receipt.invoice_id
      ? Math.max(0, Math.round((Math.min(refundedAmount, receipt.amount) - covered) * 100) / 100)
      : 0;
  return { refunded: refundedAmount, notes, uncovered };
}
