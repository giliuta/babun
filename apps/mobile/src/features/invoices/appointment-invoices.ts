// ИНВОЙСЫ ЗАПИСИ — ТОЛЬКО ЖИВЫЕ СЧЕТА, НЕ КРЕДИТ-НОТЫ.
//
// Кредит-нота живёт в той же таблице и несёт заявку своего инвойса, а статус у
// неё «выставлена». После отмены инвойса блоки «Оплата» и «Файлы» записи
// находили её по заявке и открывали как «инвойс записи» — предложения
// выставить новый не было (разбор инвойса 2026-09-22, баг 2). Правило одно на
// оба блока: аннулированные и отменённые отпадают, кредит-ноты — тоже.

export interface AppointmentInvoiceRow {
  id: string;
  appointment_id: string | null;
  status: string;
}

export function liveAppointmentInvoices<T extends AppointmentInvoiceRow>(
  invoices: readonly T[],
  appointmentId: string | null | undefined,
  creditNoteIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): T[] {
  if (!appointmentId) return [];
  return invoices.filter(
    (inv) =>
      inv.appointment_id === appointmentId &&
      inv.status !== "void" &&
      inv.status !== "cancelled" &&
      !creditNoteIds.has(inv.id),
  );
}
