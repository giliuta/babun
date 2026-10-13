// Blank / duplicated appointments and one-off («своя») service ids.

import { generateId } from "../masters";
import type { Appointment, PersonalEventRepeat } from "./types";

// ─── Factory ───────────────────────────────────────────────────────────

export function createBlankAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const now = new Date().toISOString();
  return {
    // v489 — generate a real UUID up front so the optimistic React /
    // localStorage / IDB row, the Supabase INSERT, and the sync-queue
    // replay all share the same id. Legacy `generateId("apt")` produced
    // `apt-mp2we5l1-ow18u` style strings; Supabase's `appointments.id`
    // is a uuid column, so the repo had to strip the id on insert and
    // reconcile. Worst case (network blip): the op got queued in IDB
    // with the apt-id payload, and replay then failed with «invalid
    // input syntax for type uuid», stranding the event in «Очередь
    // синхронизации». Using a UUID from the start removes the entire
    // failure mode. Falls back to the legacy generator on environments
    // without `crypto.randomUUID` (older Safari, but iOS 15.4+ has it).
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : generateId("apt"),
    created_by: null,
    date: "",
    time_start: "10:00",
    time_end: "11:00",
    client_id: null,
    location_id: null,
    team_id: null,
    service_ids: [],
    total_amount: 0,
    custom_total: false,
    discount_amount: 0,
    expenses: [],
    service_price_overrides: {},
    color_override: null,
    city: null,
    prepaid_amount: 0,
    payments: [],
    payment: null,
    services: [],
    global_discount: null,
    total_duration: 0,
    comment: "",
    address: "",
    address_note: "",
    address_lat: null,
    address_lng: null,
    source: null,
    is_online_booking: false,
    cancel_reason: null,
    kind: "work",
    photos: [],
    consent_given: true,
    reminder_enabled: false,
    reminder_offsets: [1440, 60],
    reminder_template:
      "Здравствуйте, {name}! Напоминаем: {date} в {time} по адресу {address}. Babun CRM",
    status: "scheduled",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Clone an appointment with a fresh ID, blanked-out payments and scheduled status. */
export function duplicateAppointment(apt: Appointment): Appointment {
  const now = new Date().toISOString();
  // Состав (services / service_ids / global_discount / total_duration)
  // приходит спредом целиком — обнуление services при сохранённом
  // total_amount давало копию с рассинхроном суммы и состава услуг.
  // Сбрасываются только оплата (включая зеркала) и статус.
  return {
    ...apt,
    id: generateId("apt"),
    // The server stamps the authenticated copier as the new creator. Never
    // carry the source event's author into the optimistic copy.
    created_by: null,
    prepaid_amount: 0,
    // Строки предоплаты — деньги оригинала (аудит 03.10): копия несла их, и
    // своя предоплата на копии дописывалась к чужим — сумма строк расходилась
    // с `prepaid_amount`, а блок оплаты показывал одну строку без «Снять».
    prepayments: [],
    payments: [],
    payment: null,
    payment_status: "unpaid",
    payment_method: undefined,
    paid_amount: undefined,
    status: "scheduled",
    cancel_reason: null,
    photos: [],
    // Копия повторяющегося события — РАЗОВАЯ (аудит 03.10): копия первого
    // вхождения заводила вторую серию, и дальше каждый день стояло по два
    // события (и по два пуша).
    ...(apt.event_repeat ? { event_repeat: { kind: "none" } as PersonalEventRepeat } : {}),
    created_at: now,
    updated_at: now,
  };
}

// ─── Своя (разовая) услуга ─────────────────────────────────────────────
// Владелец 2026-09-22: «в „Итого“ справа — добавить ещё одну услугу, не из
// прайса». Такая строка живёт только в своём документе: у неё нет услуги в
// справочнике, поэтому id — не uuid прайса, а `custom:<uuid>`. Имя, цена и
// время (0) едут снимком строки (`serviceName`, `pricePerUnit`, `duration`),
// и для всех читателей она выглядит как услуга, стёртая из прайса, — такие
// строки продукт читает давно. Сервер хранит id текстом и не сверяет с прайсом.

export const CUSTOM_SERVICE_PREFIX = "custom:";

export function isCustomServiceId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(CUSTOM_SERVICE_PREFIX);
}

export function newCustomServiceId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${CUSTOM_SERVICE_PREFIX}${uuid}`;
}
