// Appointment row builders: the cache (domain) projection and the queue
// (raw DB column) projection.

import type { Appointment } from "../../local/appointments";
import type { CachedAppointment, CachedAppointmentData } from "../../db/cache/sql";
// CachedAppointment (raw Row) is the queue-payload projection; CachedAppointmentData
// (full domain) is the cache-read projection. Both are used below.

// Cache row → domain. The cache stores the full domain object decorated
// with tenant_id; strip it and return a clean `Appointment` (identical to
// what the repo list returns).
export function rowToAppointment(r: CachedAppointmentData): Appointment {
  const { tenant_id: _t, ...appointment } = r;
  void _t;
  return appointment;
}

/** Build the DOMAIN cache row (what lands in `data`) from a canonical
 *  `Appointment`. Nested fields verbatim + the tenant_id bookkeeping key.
 *  `date` + `updated_at` are already on the domain object (the SQL layer
 *  reads them off the top level for its denorm columns). */
export function makeCachedRow(
  appointment: Appointment,
  tenantId: string,
): CachedAppointmentData {
  return { ...appointment, tenant_id: tenantId };
}

/** Domain view of a cached row (drops the tenant_id bookkeeping key), or an
 *  empty base when the row wasn't cached. */
export function toDomain(existing: CachedAppointmentData | null): Partial<Appointment> {
  return existing ? rowToAppointment(existing) : {};
}

/** `material_lines` is left out: the column belongs to the server
 *  (`freeze_appointment_materials`), and its trigger discards any value the
 *  app sends. */
export function makeServerRow(
  input: Appointment,
  tenantId: string,
  id: string,
  nowIso: string,
): Omit<CachedAppointment, "material_lines"> {
  return {
    id,
    tenant_id: tenantId,
    client_id: input.client_id ?? null,
    team_id: input.team_id ?? null,
    master_id: input.master_id ?? null,
    location_id: input.location_id ?? null,
    date: input.date,
    time_start: input.time_start,
    time_end: input.time_end,
    kind: input.kind ?? "work",
    status: input.status ?? "scheduled",
    total_amount: input.total_amount ?? 0,
    custom_total: input.custom_total ?? false,
    discount_amount: input.discount_amount ?? 0,
    prepaid_amount: input.prepaid_amount ?? 0,
    comment: input.comment ?? "",
    address: input.address ?? "",
    address_note: input.address_note ?? "",
    address_lat: input.address_lat ?? null,
    address_lng: input.address_lng ?? null,
    cancel_reason: input.cancel_reason ?? null,
    source: input.source ?? null,
    is_online_booking: input.is_online_booking ?? false,
    consent_given: input.consent_given ?? true,
    color_override: input.color_override ?? null,
    city: input.city ?? null,
    reminder_enabled: input.reminder_enabled ?? false,
    reminder_offsets: (input.reminder_offsets ?? []) as unknown as CachedAppointment["reminder_offsets"],
    reminder_template: input.reminder_template ?? "",
    service_ids: (input.service_ids ?? []) as unknown as CachedAppointment["service_ids"],
    services: (input.services ?? []) as unknown as CachedAppointment["services"],
    service_price_overrides: (input.service_price_overrides ?? {}) as unknown as CachedAppointment["service_price_overrides"],
    expenses: (input.expenses ?? []) as unknown as CachedAppointment["expenses"],
    payments: (input.payments ?? []) as unknown as CachedAppointment["payments"],
    prepayments: (input.prepayments ?? []) as unknown as CachedAppointment["prepayments"],
    payment: (input.payment ?? null) as CachedAppointment["payment"],
    global_discount: (input.global_discount ?? null) as CachedAppointment["global_discount"],
    total_duration: input.total_duration ?? 0,
    payment_status: input.payment_status ?? "unpaid",
    payment_method: input.payment_method ?? null,
    // БЕЗ ЭТОЙ СТРОКИ офлайн-реплей молча терял бы выбранный счёт, и деньги
    // ложились бы на угаданный — ровно то, от чего мы уходим.
    payment_account_id: input.payment_account_id ?? null,
    // НДС записи — выбор «Итого» (режим + ставка): без этих строк офлайн-
    // реплей терял бы налог, и оплата легла бы на счёт по настройкам.
    vat_mode: input.vat_mode ?? null,
    vat_rate: input.vat_rate ?? null,
    paid_amount: input.paid_amount ?? 0,
    // STORY-055 — created_by is filled server-side by the BEFORE
    // INSERT trigger; the optimistic cache row carries null and gets
    // rewritten from the insert's returned row after the real insert.
    created_by: null,
    created_at: input.created_at ?? nowIso,
    updated_at: nowIso,
    // Event-mode fields (personal calendar). All have safe defaults so
    // a non-event appointment slots in as a regular work record.
    event_all_day: input.event_all_day ?? false,
    event_notes: input.event_notes ?? "",
    event_url: input.event_url ?? "",
    event_push_enabled: input.event_push_enabled ?? false,
    event_push_offsets: (input.event_push_offsets ?? []) as unknown as CachedAppointment["event_push_offsets"],
    event_push_at: input.event_push_at ?? null,
    event_repeat: (input.event_repeat ?? { kind: "none" }) as unknown as CachedAppointment["event_repeat"],
  };
}

export function patchToRow(patch: Partial<Appointment>): Partial<CachedAppointment> {
  const out: Partial<CachedAppointment> = {};
  if (patch.client_id !== undefined) out.client_id = patch.client_id;
  if (patch.team_id !== undefined) out.team_id = patch.team_id;
  if (patch.master_id !== undefined) out.master_id = patch.master_id ?? null;
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
  if (patch.discount_amount !== undefined) out.discount_amount = patch.discount_amount;
  if (patch.prepaid_amount !== undefined) out.prepaid_amount = patch.prepaid_amount;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.address_note !== undefined) out.address_note = patch.address_note;
  if (patch.address_lat !== undefined) out.address_lat = patch.address_lat;
  if (patch.address_lng !== undefined) out.address_lng = patch.address_lng;
  if (patch.cancel_reason !== undefined) out.cancel_reason = patch.cancel_reason;
  if (patch.source !== undefined) out.source = patch.source;
  if (patch.is_online_booking !== undefined) out.is_online_booking = patch.is_online_booking;
  if (patch.consent_given !== undefined) out.consent_given = patch.consent_given;
  if (patch.color_override !== undefined) out.color_override = patch.color_override;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.reminder_enabled !== undefined) out.reminder_enabled = patch.reminder_enabled;
  if (patch.reminder_offsets !== undefined) out.reminder_offsets = patch.reminder_offsets as unknown as CachedAppointment["reminder_offsets"];
  if (patch.reminder_template !== undefined) out.reminder_template = patch.reminder_template;
  if (patch.service_ids !== undefined) out.service_ids = patch.service_ids as unknown as CachedAppointment["service_ids"];
  if (patch.services !== undefined) out.services = patch.services as unknown as CachedAppointment["services"];
  if (patch.service_price_overrides !== undefined) out.service_price_overrides = patch.service_price_overrides as unknown as CachedAppointment["service_price_overrides"];
  if (patch.expenses !== undefined) out.expenses = patch.expenses as unknown as CachedAppointment["expenses"];
  if (patch.payments !== undefined) out.payments = patch.payments as unknown as CachedAppointment["payments"];
  if (patch.prepayments !== undefined) out.prepayments = patch.prepayments as unknown as CachedAppointment["prepayments"];
  if (patch.payment !== undefined) out.payment = patch.payment as CachedAppointment["payment"];
  if (patch.global_discount !== undefined) out.global_discount = patch.global_discount as CachedAppointment["global_discount"];
  if (patch.total_duration !== undefined) out.total_duration = patch.total_duration;
  if (patch.payment_status !== undefined) out.payment_status = patch.payment_status;
  if (patch.payment_method !== undefined) out.payment_method = patch.payment_method ?? null;
  if (patch.payment_account_id !== undefined) out.payment_account_id = patch.payment_account_id ?? null;
  if (patch.paid_amount !== undefined) out.paid_amount = patch.paid_amount;
  // Event-поля личного календаря — по образцу makeServerRow. Без них
  // офлайн-правка события молча стирала event_* при реплее (payload
  // очереди не содержал колонок, а UPDATE у нас replace-семантики).
  if (patch.event_all_day !== undefined) out.event_all_day = patch.event_all_day;
  if (patch.event_notes !== undefined) out.event_notes = patch.event_notes;
  if (patch.event_url !== undefined) out.event_url = patch.event_url;
  if (patch.event_push_enabled !== undefined) out.event_push_enabled = patch.event_push_enabled;
  if (patch.event_push_offsets !== undefined) out.event_push_offsets = patch.event_push_offsets as unknown as CachedAppointment["event_push_offsets"];
  if (patch.event_push_at !== undefined) out.event_push_at = patch.event_push_at;
  if (patch.event_repeat !== undefined) out.event_repeat = patch.event_repeat as unknown as CachedAppointment["event_repeat"];
  return out;
}
