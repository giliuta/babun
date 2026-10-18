// ИНВОЙСЫ ЗАПИСИ — ТОЛЬКО ЖИВЫЕ СЧЕТА, НЕ КРЕДИТ-НОТЫ.
//
// Кредит-нота живёт в той же таблице и несёт заявку своего инвойса, а статус у
// неё «выставлена». После отмены инвойса блоки «Оплата» и «Файлы» записи
// находили её по заявке и открывали как «инвойс записи» — предложения
// выставить новый не было. Правило одно на
// оба блока: аннулированные и отменённые отпадают, кредит-ноты — тоже.
//
// КРЕДИТ-НОТА УЗНАЁТСЯ ПО `kind`, А НЕ ТОЛЬКО ПО СВЯЗИ. Нота к ЧЕКУ (возврат по
// чеку) ссылается на чек, `credit_note_of_id` у неё пуст, и в карту связей
// «нота → инвойс» она не попадает: без проверки вида она считалась бы
// инвойсом записи.

export interface AppointmentInvoiceRow {
  id: string;
  appointment_id: string | null;
  status: string;
  kind?: string | null;
}

function isCreditNoteRow(
  inv: AppointmentInvoiceRow,
  creditNoteIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): boolean {
  return inv.kind === "credit_note" || creditNoteIds.has(inv.id);
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
      !isCreditNoteRow(inv, creditNoteIds),
  );
}

/** ИНВОЙС, В КОТОРЫЙ ИДУТ ДЕНЬГИ ЗАПИСИ. Живых может быть несколько (старый
 *  ждёт оплату, новее него уже оплачен), и «первый в списке» не годится: он мог
 *  оказаться оплаченным, а блок «Оплата» решил бы, что ждать нечего, и пустил
 *  прямую оплату записи — сервер её отклоняет, пока инвойс ждёт денег. Поэтому
 *  первым берётся тот, что выставлен и ждёт оплату; иначе — самый новый живой.
 *  Список приходит от новых к старым. */
export function appointmentPayableInvoice<T extends AppointmentInvoiceRow>(
  live: readonly T[],
): T | null {
  return live.find((inv) => inv.status === "issued") ?? live[0] ?? null;
}

/** ИНВОЙСЫ В «ФАЙЛАХ» ЗАПИСИ — все её инвойсы, кроме кредит-нот: отменённый
 *  стоит серым, нота — часть его. Для денег записи
 *  («Оплата») правило прежнее — `liveAppointmentInvoices`. */
export function appointmentInvoiceFiles<T extends AppointmentInvoiceRow>(
  invoices: readonly T[],
  appointmentId: string | null | undefined,
  creditNoteIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): T[] {
  if (!appointmentId) return [];
  return invoices.filter(
    (inv) => inv.appointment_id === appointmentId && !isCreditNoteRow(inv, creditNoteIds),
  );
}
