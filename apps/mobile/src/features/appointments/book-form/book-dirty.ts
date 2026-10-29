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
  /** Точка и заметка объекта события без клиента. */
  eventPlacePin?: string;
  eventPlaceNote?: string;
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
  /** Клиент и объект, с которыми форму открыли (`/book?clientId=…`): их
   *  выбрал не человек в форме, а дверь, откуда он пришёл. */
  initialClientId?: string | null;
  initialLocationId?: string | null;
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
  eventPlacePin = "",
  eventPlaceNote = "",
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
  initialClientId = null,
  initialLocationId = null,
}: DraftDirtyInput): boolean {
  // «ЗАПИСАТЬ» С КАРТОЧКИ КЛИЕНТА — ЕЩЁ НЕ ВВОД. Клиент приехал параметром,
  // и стрелка «назад» без единого касания спрашивала «Сохранить запись?».
  const clientPicked = clientId !== initialClientId;
  const locationPicked = locationId !== initialLocationId;
  // Сравнение вида с исходным ушло вместе с переключателем: менять вид
  // внутри формы больше нечем, и при создании `kind !== initialKind`
  // ложно всегда.
  return kind === "event"
    // СОБЫТИЕ СЧИТАЕТ ТО ЖЕ, ЧТО И ЗАПИСЬ. Если список события отстаёт от списка записи
    // (выбранный клиент, объект, тип, прикреплённые файлы и заметка объекта в
    // него не входят), «Отмена» и системный свайп назад уходят МОЛЧА —
    // без вопроса «Введённое не сохранится», — и выбранный клиент с
    // фотографиями пропадал вместе с формой.
    ? notesDirty ||
      clientPicked ||
      locationPicked ||
      eventTypeId != null ||
      pendingFilesCount > 0 ||
      eventTitle.trim().length > 0 ||
      eventNotes.trim().length > 0 ||
      eventAddress.trim().length > 0 ||
      eventPlacePin.trim().length > 0 ||
      eventPlaceNote.trim().length > 0 ||
      eventUrl.trim().length > 0 ||
      eventReminderOffset != null ||
      eventColor != null ||
      repeat.kind !== "none" ||
      allDay ||
      dateTouched ||
      durationTouched
    : notesDirty ||
      clientPicked ||
      serviceIdsCount > 0 ||
      comment.trim().length > 0 ||
      // Адрес — ввод, когда он вписан без объекта или объект сменили. Адрес
      // объекта, приехавшего параметром с карточки клиента, — ещё не ввод:
      // «назад» без единого касания спрашивал «Сохранить запись?».
      (address.trim().length > 0 && (locationId == null || locationPicked)) ||
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
      durationTouched;
}
