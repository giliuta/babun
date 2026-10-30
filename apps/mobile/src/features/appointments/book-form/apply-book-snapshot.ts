import type { BookDraftSnapshot } from "./book-draft-store";
import type { BookDraft } from "./use-book-draft";

/** ПРЕРВАННАЯ ПРАВКА ЛОЖИТСЯ ПОВЕРХ ЗАПИСИ (I-04).
 *
 *  Только то, что человек меняет на форме. Повтор, ссылка события и
 *  напоминание события здесь не правятся — у правки они те же, что в записи.
 *  Зовётся ПОСЛЕ снимка «как было» (`editBaselineRef`): тот остаётся видом
 *  записи из базы, поэтому форма сразу «изменена», а «Сохранить» шлёт ровно
 *  поднятые изменения. */
export function applyBookSnapshot(
  d: BookDraft,
  setTeamId: (id: string | null) => void,
  s: Omit<BookDraftSnapshot, "v" | "savedAt">,
): void {
  setTeamId(s.teamId);
  d.setClientId(s.clientId);
  d.setLocationId(s.locationId);
  d.setAddress(s.address);
  d.setDate(s.date);
  d.setTimeStart(s.timeStart);
  d.setTimeEnd(s.timeEnd);
  d.setDurationTouched(s.durationTouched);
  d.setDurationByHand(s.durationByHand);
  d.setServiceIds(s.serviceIds);
  d.setOverrides(s.overrides);
  d.setMasterId(s.masterId);
  d.setCustomTotal(s.customTotal);
  d.setTotalDraft(s.totalDraft);
  d.setDiscountType(s.discountType);
  d.setDiscountValue(s.discountValue);
  d.setRecordVatMode(s.recordVatMode);
  d.setRecordVatRate(s.recordVatRate);
  d.setStatus(s.status);
  d.setComment(s.comment);
  d.commentNow.current = s.comment;
  d.setEventTitle(s.eventTitle);
  d.setEventColor(s.eventColor);
  d.setEventTypeId(s.eventTypeId);
  d.setEventNotes(s.eventNotes);
  d.setEventAddress(s.eventAddress);
  d.setEventPlacePin(s.eventPlacePin ?? "");
  d.setEventPlaceNote(s.eventPlaceNote ?? "");
  d.setEventPlaceTypeId(s.eventPlaceTypeId ?? null);
  d.setAllDay(s.allDay);
  d.setColorOverride(s.colorOverride);
  d.setCity(s.city);
  d.setCityTouched(s.cityTouched);
}
