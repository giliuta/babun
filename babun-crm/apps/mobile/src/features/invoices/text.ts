import type {
  InvoiceLedgerWithLines,
  InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import { formatInvoiceDate, formatInvoiceMoney } from "./format";

export function buildInvoiceShareText({
  invoice,
  companyName,
  clientName,
  settlement,
}: {
  invoice: InvoiceLedgerWithLines;
  companyName?: string | null;
  clientName?: string | null;
  settlement?: InvoiceSettlement;
}): string {
  const seller = invoice.seller_snapshot;
  const client = invoice.client_snapshot;
  // A present snapshot is authoritative as a whole. A blank snapshotted field
  // must not be filled later from a mutable company/client profile.
  //
  // Без снимка продавец — имя ТЕНАНТА (companyName), а не «Babun CRM»:
  // Babun — бренд платформы, у клиента бизнеса ему делать нечего. Нет и
  // имени тенанта — строка честно опускается, выдуманного продавца не будет.
  const sellerName = seller
    ? seller.legal_name || seller.name || seller.display_name || "Продавец не указан"
    : companyName || null;
  const recipientName = client
    ? client.full_name || "не указан"
    : clientName || "не указан";
  const lines = invoice.lines.map(
    (line) => `${line.title}: ${line.qty} × ${formatInvoiceMoney(line.unit_price, invoice.currency)} = ${formatInvoiceMoney(line.total, invoice.currency)}`,
  );
  return [
    sellerName,
    seller?.vat_number ? `VAT: ${seller.vat_number}` : null,
    `Инвойс ${invoice.number}`,
    `Клиент: ${recipientName}`,
    client?.primary_address ? `Адрес: ${client.primary_address}` : null,
    `Дата: ${formatInvoiceDate(invoice.issued_on)}`,
    invoice.due_on ? `Оплатить до: ${formatInvoiceDate(invoice.due_on)}` : null,
    "",
    ...lines,
    "",
    invoice.vat_amount > 0
      ? `VAT ${invoice.vat_percent}%: ${formatInvoiceMoney(invoice.vat_amount, invoice.currency)}`
      : null,
    `Итого: ${formatInvoiceMoney(invoice.total, invoice.currency)}`,
    settlement && settlement.paid > 0
      ? `Оплачено: ${formatInvoiceMoney(settlement.paid, invoice.currency)}`
      : null,
    settlement && settlement.remaining > 0
      ? `Остаток: ${formatInvoiceMoney(settlement.remaining, invoice.currency)}`
      : null,
    seller?.iban ? `IBAN: ${seller.iban}` : null,
    invoice.notes || null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
