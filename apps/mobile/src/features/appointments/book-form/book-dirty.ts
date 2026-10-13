import type { AppointmentStatus, PersonalEventRepeat } from "@babun/shared/local/appointments";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { parseMoneyInput } from "@/features/appointments/helpers";

// ── «есть несохранённое» ── (the creation half; editing compares the patch
// signature with the baseline, see `use-leave-guard.ts`).

export interface DraftDirtyInput {
  kind: "work" | "event";
  notesDirty: boolean;
  clientId: string | null;
  locationId: string | null;
  eventTypeId: string | null;
  pendingFilesCount: number;
  eventTitle: string;
  eventNotes: string;
  eventAddress: string;
  eventUrl: string;
  eventReminderOffset: number | null;
  eventColor: string | null;
  repeat: PersonalEventRepeat;
  allDay: boolean;
  /** `dateTouchedRef.current` at render time. */
  dateTouched: boolean;
  durationTouched: boolean;
  serviceIdsCount: number;
  comment: string;
  address: string;
  customTotal: boolean;
  discountValue: string;
  recordVatMode: TxVatMode;
  status: AppointmentStatus;
  reminderOn: boolean;
  hasPendingPayment: boolean;
  colorOverride: string | null;
  cityTouched: boolean;
}

/** Did the person type or pick anything in a NEW record / event? */
export function draftDirty({
  kind,
  notesDirty,
  clientId,
  locationId,
  eventTypeId,
  pendingFilesCount,
  eventTitle,
  eventNotes,
  eventAddress,
  eventUrl,
  eventReminderOffset,
  eventColor,
  repeat,
  allDay,
  dateTouched,
  durationTouched,
  serviceIdsCount,
  comment,
  address,
  customTotal,
  discountValue,
  recordVatMode,
  status,
  reminderOn,
  hasPendingPayment,
  colorOverride,
  cityTouched,
}: DraftDirtyInput): boolean {
  // Сравнение вида с исходным ушло вместе с переключателем: менять вид
  // внутри формы больше нечем, и при создании `kind !== initialKind`
  // ложно всегда.
  return kind === "event"
    // СОБЫТИЕ СЧИТАЕТ ТО ЖЕ, ЧТО И ЗАПИСЬ (аудит 2026-09-10). Список
    // события отставал от списка записи: выбранный клиент, выбранный
    // объект, выбранный тип, прикреплённые файлы и заметка объекта в него
    // не входили. Значит «Отмена» и системный свайп назад уходили МОЛЧА —
    // без вопроса «Введённое не сохранится», — и выбранный клиент с
    // фотографиями пропадал вместе с формой.
    ? notesDirty ||
      clientId != null ||
      locationId != null ||
      eventTypeId != null ||
      pendingFilesCount > 0 ||
      eventTitle.trim().length > 0 ||
      eventNotes.trim().length > 0 ||
      eventAddress.trim().length > 0 ||
      eventUrl.trim().length > 0 ||
      eventReminderOffset != null ||
      eventColor != null ||
      repeat.kind !== "none" ||
      allDay ||
      dateTouched ||
      durationTouched
    : notesDirty ||
      clientId != null ||
      serviceIdsCount > 0 ||
      comment.trim().length > 0 ||
      address.trim().length > 0 ||
      customTotal ||
      // Скидкой считается ВПИСАННОЕ, а не выбранная валюта: переключить
      // «€ | %» и ничего не набрать — не значит тронуть запись.
      parseMoneyInput(discountValue) > 0 ||
      recordVatMode !== "none" ||
      status !== "scheduled" ||
      reminderOn ||
      hasPendingPayment ||
      pendingFilesCount > 0 ||
      colorOverride != null ||
      cityTouched ||
      dateTouched ||
      durationTouched ||
      notesDirty;
}
