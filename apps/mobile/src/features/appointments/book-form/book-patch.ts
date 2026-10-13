import type {
  Appointment,
  AppointmentService,
  AppointmentStatus,
  Discount,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";
import {
  locationAddressForBooking,
  type Client,
  type Location,
} from "@babun/shared/local/clients";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import { minutesBetweenHM } from "@/features/appointments/helpers";

export interface BookPatchInput {
  kind: "work" | "event";
  isEdit: boolean;
  date: string;
  timeStart: string;
  timeEnd: string;
  teamId: string | null;
  city: string | null;
  clientId: string | null;
  locationId: string | null;
  // event
  /** The picked object of the event (any client's), if any. */
  eventLoc: Location | null;
  eventAddress: string;
  allDay: boolean;
  repeat: PersonalEventRepeat;
  eventNotes: string;
  eventUrl: string;
  eventReminderOffset: number | null;
  eventTypeLabel: string | null;
  eventTitle: string;
  eventColor: string | null;
  // work
  masterId: string | null;
  serviceIds: string[];
  selectedServices: AppointmentService[];
  effectiveTotal: number;
  customTotal: boolean;
  computedDuration: number;
  /** The record note as typed right now (`commentNow`). */
  comment: string;
  status: AppointmentStatus;
  clientLocations: readonly Location[];
  address: string;
  colorOverride: string | null;
  globalDiscount: Discount | null;
  discountAmount: number;
  recordVatMode: TxVatMode;
  vatRateInUse: number;
  reminderOn: boolean;
  client: Pick<Client, "phone" | "contacts_hidden"> | null;
}

// ── сохранение (тот же контракт, что старый шит) ──
export function buildBookPatch(input: BookPatchInput): Partial<Appointment> {
  const {
    kind,
    isEdit,
    date,
    timeStart,
    timeEnd,
    teamId,
    city,
    clientId,
    locationId,
    eventLoc,
    eventAddress,
    allDay,
    repeat,
    eventNotes,
    eventUrl,
    eventReminderOffset,
    eventTypeLabel,
    eventTitle,
    eventColor,
    masterId,
    serviceIds,
    selectedServices,
    effectiveTotal,
    customTotal,
    computedDuration,
    comment,
    status,
    clientLocations,
    address,
    colorOverride,
    globalDiscount,
    discountAmount,
    recordVatMode,
    vatRateInUse,
    reminderOn,
    client,
  } = input;
  if (kind === "event") {
    // Одна строка «адрес или ссылка»: ссылка — в event_url, текст — в
    // address. Адрес события — его собственный, не объект из базы
    // (владелец 2026-09-06: «просто адрес, фиксируется только на событии»).
    // Выбран объект — адрес-снимок берётся у него; нет объекта — остаётся
    // прежний вольный адрес события (у старых событий он единственное, что
    // говорит, куда ехать, и терять его нельзя).
    const place = eventLoc
      ? locationAddressForBooking(eventLoc)
      : eventAddress.trim();
    const placeIsUrl = !eventLoc && isLikelyUrl(place);
    return {
      kind: "event",
      date,
      time_start: timeStart,
      time_end: timeEnd,
      // «Весь день», повтор и напоминание с формы сняты; у прежних событий
      // их значения не трогаем — они уезжают как загрузились.
      event_all_day: allDay,
      event_repeat: repeat,
      event_notes: eventNotes.trim(),
      event_url: placeIsUrl ? place : eventUrl.trim(),
      event_push_enabled: eventReminderOffset != null,
      event_push_offsets:
        eventReminderOffset == null ? [] : [eventReminderOffset],
      event_push_at: null,
      team_id: teamId,
      // Team events belong to the team; personal events belong to their
      // creator through RLS. A hidden stale work-master must not leak in.
      master_id: null,
      status: "scheduled",
      comment: (eventTypeLabel ?? eventTitle.trim()) || "Событие",
      address: placeIsUrl ? "" : place,
      color_override: eventColor,
      // Метка события — та же метка выезда, что у записи: null значит «как
      // у дня» (владелец 2026-09-08: «тип справа вверху переделай на метку,
      // как в клиентах»).
      city,
      // Клиент и объект у события необязательны и НЕЗАВИСИМЫ: объект может
      // принадлежать другому клиенту или стоять вовсе без клиента события.
      client_id: clientId,
      location_id: locationId,
      service_ids: [],
      services: [],
      total_amount: 0,
      custom_total: false,
      global_discount: null,
      discount_amount: 0,
    };
  }
  const patch: Partial<Appointment> = {
    kind: "work",
    client_id: clientId,
    date,
    time_start: timeStart,
    time_end: timeEnd,
    team_id: teamId,
    master_id: masterId,
    service_ids: serviceIds,
    services: selectedServices,
    total_amount: effectiveTotal,
    custom_total: customTotal,
    // A job without a catalog service still has the duration selected in
    // the time picker. Persist the actual slot instead of a misleading 0.
    total_duration:
      computedDuration > 0
        ? computedDuration
        : minutesBetweenHM(timeStart, timeEnd),
    comment: comment.trim(),
    status,
    // Объект могли удалить листом правки прямо отсюда: висячий id в новую
    // запись не пишем, адрес-снимок остаётся. Правку не трогаем — там
    // пропавший объект законен, адрес держит снимок записи.
    location_id:
      isEdit || locationId == null || clientLocations.some((l) => l.id === locationId)
        ? locationId
        : null,
    address: address.trim(),
    color_override: colorOverride,
    // Метка записи: null — «как у дня», строка — своя.
    city,
    global_discount: globalDiscount,
    discount_amount: discountAmount,
    // Налог пишется только у рабочей записи с расчётной суммой: у старой
    // «своей суммы» его не выбирали, и тихо навешивать нельзя.
    ...(kind === "work" && !customTotal
      ? recordVatMode !== "none" && vatRateInUse > 0
        ? { vat_mode: recordVatMode, vat_rate: vatRateInUse }
        : { vat_mode: "none" as const, vat_rate: null }
      : {}),
    // У сотрудника номер клиента в записи не приходит (`contacts_hidden`,
    // 30.09) — напоминание шлёт сервер по карточке, номер ему известен.
    reminder_enabled:
      reminderOn && (Boolean(client?.phone) || client?.contacts_hidden !== undefined),
  };
  return patch;
}
