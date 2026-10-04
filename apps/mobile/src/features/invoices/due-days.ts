// СРОК ЗАПОМИНАЕТСЯ ПО ЧЕЛОВЕКУ (владелец 2026-10-03: «стандарт — 30 дней;
// поставил на прошлом инвойсе 7 — следующий будет 7; переделал на 30 —
// дальше 30»). Настройки срока больше нет: память — сами выставленные
// документы. Свой последний инвойс (не кредит-нота, с датой оплаты) говорит,
// сколько дней ставить; ни одного — 30.
export const FIRST_INVOICE_DUE_DAYS = 30;

type DueSource = {
  kind?: string | null;
  created_by: string | null;
  created_at: string;
  issued_on: string;
  due_on: string | null;
};

/** Дни между двумя `YYYY-MM-DD` — по календарю, без часовых поясов. */
function ymdDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function rememberedDueDays(
  invoices: readonly DueSource[] | undefined,
  me: string | null,
): number {
  if (!me || !invoices) return FIRST_INVOICE_DUE_DAYS;
  let last: DueSource | null = null;
  for (const invoice of invoices) {
    if (invoice.kind === "credit_note" || invoice.created_by !== me || !invoice.due_on) continue;
    if (!last || invoice.created_at > last.created_at) last = invoice;
  }
  if (!last?.due_on) return FIRST_INVOICE_DUE_DAYS;
  const days = ymdDiff(last.issued_on, last.due_on);
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : FIRST_INVOICE_DUE_DAYS;
}
