import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import {
  INVOICE_STATUS_LABELS,
  invoiceDisplayStatus,
  type InvoiceLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";

const VARIANT: Record<ReturnType<typeof invoiceDisplayStatus>, BadgeVariant> = {
  issued: "warning",
  partial: "brand",
  // НЕ danger: «неоплаченный документ — ничего страшного, не надо выставлять
  // его якобы красным» (владелец 2026-08-15). Слово «Просрочен» сказано — тон
  // тот же спокойный, что у любого ждущего оплаты.
  overdue: "warning",
  paid: "success",
  void: "neutral",
  cancelled: "neutral",
};

export function InvoiceStatusBadge({
  invoice,
  settlement,
  today,
}: {
  invoice: InvoiceLedger;
  settlement?: InvoiceSettlement;
  today?: string;
}) {
  const status = invoiceDisplayStatus(invoice, today, settlement);
  return <Badge label={INVOICE_STATUS_LABELS[status]} variant={VARIANT[status]} />;
}
