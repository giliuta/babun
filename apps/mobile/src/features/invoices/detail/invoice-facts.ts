type InvoiceLike = {
  id: string;
  kind?: string | null;
  status: string;
  due_on?: string | null;
  client_id?: string | null;
  credit_note_of_id?: string | null;
};

/** Что страница инвойса знает о документе, кроме бумаги: нота ли это, чья,
 *  какие ноты у него есть и ждёт ли он денег. Чистое правило — без React. */
export function invoiceFacts<T extends InvoiceLike>({
  row,
  all,
  stornoOfId,
  remaining,
  businessToday,
}: {
  row: T;
  all: readonly T[];
  /** Инвойс, который сторнирует эта нота (из связей нот), или null. */
  stornoOfId: string | null;
  remaining: number;
  businessToday: string;
}) {
  // Кредит-нота — не инвойс: не оплачивается, не редактируется и не
  // отменяется, а честно называет себя и ссылается на сторнированный документ.
  const isCreditNote = stornoOfId != null || row.kind === "credit_note";
  const stornoOfInvoice = stornoOfId ? (all.find((item) => item.id === stornoOfId) ?? null) : null;
  // Все ноты инвойса — частичные и полная, плашками в «Документах».
  const creditNotes = all.filter((item) => item.kind === "credit_note" && item.credit_note_of_id === row.id);
  // Отменённый (сторнированный) инвойс и кредит-нота денег не ждут.
  const awaitsPayment = row.status !== "void" && row.status !== "cancelled" && !isCreditNote && remaining > 0;
  const isOverdue = awaitsPayment && !!row.due_on && row.due_on < businessToday;
  const unassigned = !row.client_id && !isCreditNote;
  return { isCreditNote, stornoOfInvoice, creditNotes, awaitsPayment, isOverdue, unassigned };
}
