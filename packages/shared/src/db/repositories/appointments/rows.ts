// Appointments repository — column ↔ field adapters. The only place that
// knows how the local `Appointment` maps onto the `appointments` row; the
// public API (`../appointments.ts`) reads and writes through them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../database.types";
import type {
  Appointment,
  AppointmentExpense,
  AppointmentKind,
  AppointmentPayment,
  AppointmentService,
  AppointmentSource,
  AppointmentStatus,
  Discount,
  Payment,
} from "../../../local/appointments";
import { toJson } from "../../json";

export type DbSupabase = SupabaseClient<Database>;
export type Row = Database["public"]["Tables"]["appointments"]["Row"];
type Insert = Database["public"]["Tables"]["appointments"]["Insert"];
type Update = Database["public"]["Tables"]["appointments"]["Update"];

// STORY-049 — `photos` column dropped from appointments. Photos now
// live in public.appointment_photos (blobs in Storage). The list /
// get / insert / update paths below no longer touch any photos
// field; UI fetches photos lazily via the appointment-photos repo.

// ─── Adapters ──────────────────────────────────────────────────

function asArray<T>(v: Json | null | undefined): T[] {
  return Array.isArray(v) ? (v as unknown as T[]) : [];
}

function asObj<T extends object>(v: Json | null | undefined): T {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as unknown as T)
    : ({} as T);
}

/** Build an Appointment from a row that MAY OR MAY NOT include photos.
 *  Экспортирован для реплеера: его конфликтная ветка кладёт в кэш
 *  канонический ответ сервера, а кэш хранит ДОМЕННУЮ форму — сырая Row
 *  (без photos:[], с numeric-строками) ломала бы читателей. */
export function rowToAppointment(r: Row): Appointment {
  return {
    id: r.id,
    created_by: r.created_by,
    date: r.date,
    time_start: r.time_start,
    time_end: r.time_end,
    client_id: r.client_id,
    location_id: r.location_id,
    team_id: r.team_id,
    master_id: r.master_id,
    service_ids: asArray<string>(r.service_ids),
    total_amount: Number(r.total_amount ?? 0),
    custom_total: r.custom_total,
    discount_amount: Number(r.discount_amount ?? 0),
    expenses: asArray<AppointmentExpense>(r.expenses),
    service_price_overrides: asObj<Record<string, number>>(
      r.service_price_overrides,
    ),
    color_override: r.color_override,
    city: r.city ?? null,
    prepaid_amount: Number(r.prepaid_amount ?? 0),
    // v-W4 — mirror payment columns. The server income trigger fires on
    // status='completed' AND payment_status='paid'; the mobile «Завершена
    // → Наличные/Карта» flow writes these and they must round-trip so the
    // read model matches web (DebtorsList/ledger key on payment_status).
    payment_status:
      (r.payment_status ?? undefined) as Appointment["payment_status"],
    payment_method:
      (r.payment_method ?? undefined) as Appointment["payment_method"],
    // Счёт, выбранный при приёме денег. Без него сервер угадывает счёт по
    // способу оплаты — и промахивается, когда счёта такого вида у команды нет.
    payment_account_id: r.payment_account_id ?? null,
    // НДС записи: выбор «Итого» (режим + ставка); старые 'on'/'off'
    // пишет дверь `set_appointment_vat_mode`.
    vat_mode: (r.vat_mode ?? null) as Appointment["vat_mode"],
    vat_rate: r.vat_rate == null ? null : Number(r.vat_rate),
    // Пишет только сервер (миграция 20260930235800); в запись на сервер
    // поле не уходит.
    material_lines: r.material_lines ?? null,
    paid_amount:
      r.paid_amount === null || r.paid_amount === undefined
        ? undefined
        : Number(r.paid_amount),
    payments: asArray<Payment>(r.payments),
    prepayments: asArray<Payment>(r.prepayments),
    payment: (r.payment ?? null) as AppointmentPayment | null,
    services: asArray<AppointmentService>(r.services),
    global_discount: (r.global_discount ?? null) as Discount | null,
    total_duration: r.total_duration ?? 0,
    comment: r.comment,
    address: r.address,
    address_note: r.address_note,
    address_lat: r.address_lat,
    address_lng: r.address_lng,
    // Колонки до наката нет в типах базы: читаем, если сервер её отдал.
    ...("address_object_type_id" in r
      ? { address_object_type_id: (r as { address_object_type_id?: string | null }).address_object_type_id ?? null }
      : {}),
    source: (r.source ?? null) as AppointmentSource | null,
    is_online_booking: r.is_online_booking,
    cancel_reason: r.cancel_reason,
    kind: r.kind as AppointmentKind,
    // STORY-049 — photos removed from the appointments row; UI fetches
    // them separately via @babun/shared/db/repositories/appointment-photos.
    photos: [],
    consent_given: r.consent_given,
    reminder_enabled: r.reminder_enabled,
    reminder_offsets: asArray<number>(r.reminder_offsets),
    reminder_template: r.reminder_template,
    status: r.status as AppointmentStatus,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // Personal-calendar event fields.
    event_all_day: r.event_all_day ?? undefined,
    event_notes: r.event_notes ?? undefined,
    event_url: r.event_url ?? undefined,
    event_push_enabled: r.event_push_enabled ?? undefined,
    event_push_offsets: Array.isArray(r.event_push_offsets)
      ? asArray<number>(r.event_push_offsets)
      : undefined,
    event_push_at: r.event_push_at ?? undefined,
    event_repeat: (r.event_repeat ?? undefined) as Appointment["event_repeat"],
  };
}

export function appointmentToInsert(a: Appointment, tenantId: string): Insert {
  // The id is generated by the DB unless the caller explicitly
  // provides a UUID. Local `apt_xxx` ids from the legacy localStorage
  // path are NOT UUIDs — callers (e.g. import button) drop the id and
  // let the DB allocate one.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    a.id,
  );
  return {
    id: isUuid ? a.id : undefined,
    tenant_id: tenantId,
    client_id: a.client_id,
    team_id: a.team_id ?? null,
    master_id: a.master_id ?? null,
    location_id: a.location_id,
    date: a.date,
    time_start: a.time_start,
    time_end: a.time_end,
    kind: a.kind,
    status: a.status,
    total_amount: a.total_amount,
    custom_total: a.custom_total,
    discount_amount: a.discount_amount,
    ...(a.vat_mode !== undefined ? { vat_mode: a.vat_mode } : {}),
    ...(a.vat_rate !== undefined ? { vat_rate: a.vat_rate } : {}),
    prepaid_amount: a.prepaid_amount,
    // v-W4 — payment mirror columns (see rowToAppointment). Undefined
    // lets the DB default (payment_status='unpaid') stand.
    ...(a.payment_status !== undefined
      ? { payment_status: a.payment_status }
      : {}),
    ...(a.payment_account_id !== undefined
      ? { payment_account_id: a.payment_account_id ?? null }
      : {}),
    ...(a.payment_method !== undefined
      ? { payment_method: a.payment_method ?? null }
      : {}),
    ...(a.paid_amount !== undefined ? { paid_amount: a.paid_amount } : {}),
    comment: a.comment,
    address: a.address,
    address_note: a.address_note,
    address_lat: a.address_lat,
    address_lng: a.address_lng,
    // Тип объекта события — только заданный: до наката колонки ключ сломал
    // бы вставку.
    ...(a.address_object_type_id !== undefined
      ? ({ address_object_type_id: a.address_object_type_id } as Partial<Insert>)
      : {}),
    cancel_reason: a.cancel_reason,
    source: a.source,
    is_online_booking: a.is_online_booking,
    consent_given: a.consent_given,
    color_override: a.color_override,
    city: a.city ?? null,
    reminder_enabled: a.reminder_enabled,
    reminder_offsets: toJson(a.reminder_offsets ?? []),
    reminder_template: a.reminder_template,
    service_ids: toJson(a.service_ids ?? []),
    services: toJson(a.services ?? []),
    service_price_overrides:
      toJson(a.service_price_overrides ?? {}),
    expenses: toJson(a.expenses ?? []),
    payments: toJson(a.payments ?? []),
    payment: toJson(a.payment),
    // STORY-049 — photos column gone from schema; ignore here.
    global_discount: toJson(a.global_discount),
    total_duration: a.total_duration,
    created_at: a.created_at || undefined,
    // updated_at handled by the DB trigger.
    // Personal-calendar event fields: sent only when set, so the column
    // defaults apply to work records.
    ...(a.event_all_day !== undefined ? { event_all_day: a.event_all_day } : {}),
    ...(a.event_notes !== undefined ? { event_notes: a.event_notes } : {}),
    ...(a.event_url !== undefined ? { event_url: a.event_url } : {}),
    ...(a.event_push_enabled !== undefined ? { event_push_enabled: a.event_push_enabled } : {}),
    ...(a.event_push_offsets !== undefined ? { event_push_offsets: toJson(a.event_push_offsets) } : {}),
    ...(a.event_push_at !== undefined ? { event_push_at: a.event_push_at } : {}),
    ...(a.event_repeat !== undefined ? { event_repeat: toJson(a.event_repeat) } : {}),
  };
}

/** Правка записи — колонками базы. Её же ждёт `refund_overpayment_and_save`
 *  от владельца и диспетчера (`appointment-payments.ts`). */
export function appointmentToUpdate(patch: Partial<Appointment>): Update {
  const out: Update = {};
  // Scalars.
  if (patch.client_id !== undefined) out.client_id = patch.client_id;
  if (patch.team_id !== undefined) out.team_id = patch.team_id;
  if (patch.master_id !== undefined) out.master_id = patch.master_id;
  if (patch.location_id !== undefined) out.location_id = patch.location_id;
  if (patch.date !== undefined) out.date = patch.date;
  if (patch.time_start !== undefined) out.time_start = patch.time_start;
  if (patch.time_end !== undefined) out.time_end = patch.time_end;
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.total_amount !== undefined) out.total_amount = patch.total_amount;
  if (patch.vat_mode !== undefined) out.vat_mode = patch.vat_mode;
  if (patch.vat_rate !== undefined) out.vat_rate = patch.vat_rate;
  if (patch.custom_total !== undefined) out.custom_total = patch.custom_total;
  if (patch.discount_amount !== undefined)
    out.discount_amount = patch.discount_amount;
  if (patch.prepaid_amount !== undefined)
    out.prepaid_amount = patch.prepaid_amount;
  // v-W4 — payment mirror columns. Without these the «Завершена →
  // Наличные/Карта» flow's payment_status='paid' is silently dropped and
  // the server income trigger never fires (finance_transactions stays
  // empty). Mirrors web appointmentsCached.ts.
  if (patch.payment_status !== undefined)
    out.payment_status = patch.payment_status;
  if (patch.payment_method !== undefined)
    out.payment_method = patch.payment_method ?? null;
  if (patch.payment_account_id !== undefined)
    out.payment_account_id = patch.payment_account_id ?? null;
  if (patch.paid_amount !== undefined) out.paid_amount = patch.paid_amount;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.address_note !== undefined) out.address_note = patch.address_note;
  if (patch.address_lat !== undefined) out.address_lat = patch.address_lat;
  if (patch.address_lng !== undefined) out.address_lng = patch.address_lng;
  if (patch.address_object_type_id !== undefined) {
    (out as Update & { address_object_type_id?: string | null }).address_object_type_id =
      patch.address_object_type_id;
  }
  if (patch.cancel_reason !== undefined) out.cancel_reason = patch.cancel_reason;
  if (patch.source !== undefined) out.source = patch.source;
  if (patch.is_online_booking !== undefined)
    out.is_online_booking = patch.is_online_booking;
  if (patch.consent_given !== undefined) out.consent_given = patch.consent_given;
  if (patch.color_override !== undefined)
    out.color_override = patch.color_override;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.reminder_enabled !== undefined)
    out.reminder_enabled = patch.reminder_enabled;
  if (patch.reminder_template !== undefined)
    out.reminder_template = patch.reminder_template;
  if (patch.total_duration !== undefined)
    out.total_duration = patch.total_duration;

  // Nested — REPLACED ATOMICALLY (see header).
  if (patch.reminder_offsets !== undefined)
    out.reminder_offsets = toJson(patch.reminder_offsets);
  if (patch.service_ids !== undefined)
    out.service_ids = toJson(patch.service_ids);
  if (patch.services !== undefined)
    out.services = toJson(patch.services);
  if (patch.service_price_overrides !== undefined)
    out.service_price_overrides = toJson(patch.service_price_overrides);
  if (patch.expenses !== undefined)
    out.expenses = toJson(patch.expenses);
  if (patch.payments !== undefined)
    out.payments = toJson(patch.payments);
  if (patch.payment !== undefined)
    out.payment = toJson(patch.payment);
  // STORY-049 — patch.photos is intentionally ignored; the column
  // doesn't exist anymore. PhotoBlock writes via the dedicated repo.
  if (patch.global_discount !== undefined)
    out.global_discount = toJson(patch.global_discount);
  // Personal-calendar event fields.
  if (patch.event_all_day !== undefined) out.event_all_day = patch.event_all_day;
  if (patch.event_notes !== undefined) out.event_notes = patch.event_notes;
  if (patch.event_url !== undefined) out.event_url = patch.event_url;
  if (patch.event_push_enabled !== undefined)
    out.event_push_enabled = patch.event_push_enabled;
  if (patch.event_push_offsets !== undefined)
    out.event_push_offsets = toJson(patch.event_push_offsets);
  if (patch.event_push_at !== undefined) out.event_push_at = patch.event_push_at;
  if (patch.event_repeat !== undefined)
    out.event_repeat = toJson(patch.event_repeat);
  return out;
}
