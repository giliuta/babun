import type { InvoiceLedger } from "@babun/shared/local/finance/invoice-ledger";

// УДАЛИТЬ ИНВОЙС ЦЕЛИКОМ (смахнуть вправо), и порядковый номер восстанавливается.
// Правило то же, что у сервера
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

/** Вернётся ли номер в серию. `delete_invoice` откатывает счётчик серии, только
 *  когда тот стоит ровно на этом номере: ушёл дальше (номер подняли руками) —
 *  номер пропадает. `next` — следующий номер серии этих реквизитов и года
 *  (`peek_document_number`); без реквизитов серию не узнать — не обещаем. */
export function deleteFreesNumber(
  invoice: Pick<InvoiceLedger, "seq" | "company_id">,
  next: { seq: number } | null | undefined,
): boolean {
  return !!invoice.company_id && next?.seq === invoice.seq + 1;
}
