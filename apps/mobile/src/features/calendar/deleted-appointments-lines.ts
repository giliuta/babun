import { formatCountRu, type PluralFormsRu } from "@babun/shared/common/utils/plural-ru";

// ПОДПИСИ «УДАЛЁННЫХ ЗАПИСЕЙ» — без React, чтобы их держал тест.

const FORMS_RECORD: PluralFormsRu = ["запись", "записи", "записей"];

/** Дверь «Удалённые записи» в шестерёнке календаря: «Пусто» либо
 *  «2 записи» — сколько в ящике у открытого календаря. */
export function deletedAppointmentsDoorLine(count: number): string {
  return count > 0 ? formatCountRu(count, FORMS_RECORD) : "Пусто";
}

/** «Вернуть» у строки ящика: рабочую запись — тот, кому её видно; событие —
 *  только автор (сервер не пускает событие с чужим автором). */
export function canRestoreDeleted(
  item: { kind: string; createdBy: string | null },
  me: string | null,
): boolean {
  return item.kind === "work" || (!!me && item.createdBy === me);
}
