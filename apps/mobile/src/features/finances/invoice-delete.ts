import type { InvoiceLedger } from "@babun/shared/local/finance/invoice-ledger";

// УДАЛИТЬ ИНВОЙС ЦЕЛИКОМ (владелец 2026-10-04: «смахнуть вправо — удалить, и
// тогда восстанавливается порядковый номер»). Правило то же, что у сервера
// (`delete_invoice`, миграция 20261004060000): выставленный, без денег, без
// чека и кредит-ноты, и ПОСЛЕДНИЙ в серии своих реквизитов и года — номер
// возвращается в серию без дыры. Остальное отменяют кредит-нотой.

export type InvoiceDeleteBlock = "not-invoice" | "settled" | "not-last" | null;

export function invoiceDeleteBlock(
  invoice: InvoiceLedger,
  all: readonly InvoiceLedger[],
  /** Были ли по нему платежи или чек. */
  hasMoney: boolean,
): InvoiceDeleteBlock {
  if ((invoice.kind ?? "invoice") !== "invoice" || invoice.credit_note_of_id) return "not-invoice";
  if (invoice.status !== "issued" || hasMoney) return "settled";
  if (all.some((item) => item.credit_note_of_id === invoice.id)) return "settled";
  const later = all.some(
    (item) =>
      item.id !== invoice.id &&
      (item.kind ?? "invoice") === "invoice" &&
      !item.credit_note_of_id &&
      item.company_id === invoice.company_id &&
      item.year === invoice.year &&
      item.seq > invoice.seq,
  );
  return later ? "not-last" : null;
}
