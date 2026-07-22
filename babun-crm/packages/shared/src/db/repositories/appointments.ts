// Appointments repository — STORY-042.
//
// Single bridge between the UI shape (`@babun/shared/local/appointments`
// → `Appointment`) and the Supabase row shape (`Database['public']
// ['Tables']['appointments']['Row']`). Every nested array / object on
// the local Appointment lives in jsonb on the DB; the adapters below
// are the only place that knows the column ↔ field mapping.
//
// SEMANTICS — `updateAppointment` REPLACES the supplied jsonb fields
// atomically (no merge). If the caller wants to add a single photo,
// the caller assembles `[...existing, newPhoto]` and passes the full
// array; the repo writes that array verbatim. This matches `clients`
// repository semantics and avoids partial-update races where two
// browsers each add their own item and one wins.
//
// PERFORMANCE — `listAppointments` projects every column EXCEPT
// `photos` (decision Q2). Photos can be 50–500 KB base64 strings; a
// 100-row weekly grid would be tens of MB if eagerly fetched. The
// AppointmentSheet path uses `getAppointment(id)` which selects the
// full row including photos.
//
// RLS — every call expects a Supabase client authenticated as either
// `anon` (no session, `current_tenant_id()` → NULL → 0 rows) or
// `authenticated` (session cookie). The explicit `.eq('tenant_id',
// tenantId)` filters below are redundant for security but kept as
// belt-and-suspenders + helps PostgREST pick a faster index path on
// `idx_appointments_tenant_date`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
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
} from "../../local/appointments";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["appointments"]["Row"];
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
    prepaid_amount: Number(r.prepaid_amount ?? 0),
    // v-W4 — mirror payment columns. The server income trigger fires on
    // status='completed' AND payment_status='paid'; the mobile «Завершена
    // → Наличные/Карта» flow writes these and they must round-trip so the
    // read model matches web (DebtorsList/ledger key on payment_status).
    payment_status:
      (r.payment_status ?? undefined) as Appointment["payment_status"],
    payment_method:
      (r.payment_method ?? undefined) as Appointment["payment_method"],
    paid_amount:
      r.paid_amount === null || r.paid_amount === undefined
        ? undefined
        : Number(r.paid_amount),
    payments: asArray<Payment>(r.payments),
    payment: (r.payment ?? null) as AppointmentPayment | null,
    services: asArray<AppointmentService>(r.services),
    global_discount: (r.global_discount ?? null) as Discount | null,
    total_duration: r.total_duration ?? 0,
    comment: r.comment,
    address: r.address,
    address_note: r.address_note,
    address_lat: r.address_lat,
    address_lng: r.address_lng,
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
    // v665 — event_* fields. Live on the DB as of the
    // add_event_fields_to_appointments migration; before that they
    // were localStorage-only and silently dropped on cross-device
    // sync. Older Supabase deployments without the columns fall
    // through to undefined via the indexed cast (same pattern as
    // calendar_settings.work_*_hour).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_all_day: (r as any).event_all_day ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_notes: (r as any).event_notes ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_url: (r as any).event_url ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_push_enabled: (r as any).event_push_enabled ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_push_offsets: Array.isArray((r as any).event_push_offsets)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (r as any).event_push_offsets
      : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_push_at: (r as any).event_push_at ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event_repeat: (r as any).event_repeat ?? undefined,
  };
}

function appointmentToInsert(a: Appointment, tenantId: string): Insert {
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
    prepaid_amount: a.prepaid_amount,
    // v-W4 — payment mirror columns (see rowToAppointment). Undefined
    // lets the DB default (payment_status='unpaid') stand.
    ...(a.payment_status !== undefined
      ? { payment_status: a.payment_status }
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
    cancel_reason: a.cancel_reason,
    source: a.source,
    is_online_booking: a.is_online_booking,
    consent_given: a.consent_given,
    color_override: a.color_override,
    reminder_enabled: a.reminder_enabled,
    reminder_offsets: (a.reminder_offsets ?? []) as unknown as Json,
    reminder_template: a.reminder_template,
    service_ids: (a.service_ids ?? []) as unknown as Json,
    services: (a.services ?? []) as unknown as Json,
    service_price_overrides:
      (a.service_price_overrides ?? {}) as unknown as Json,
    expenses: (a.expenses ?? []) as unknown as Json,
    payments: (a.payments ?? []) as unknown as Json,
    payment: a.payment as unknown as Json | null,
    // STORY-049 — photos column gone from schema; ignore here.
    global_discount: a.global_discount as unknown as Json | null,
    total_duration: a.total_duration,
    created_at: a.created_at || undefined,
    // updated_at handled by the DB trigger.
    // v665 — event_* fields. Indexed cast so older Supabase deploys
    // without the columns get a graceful 42703 retry below (added).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_all_day !== undefined ? { event_all_day: a.event_all_day } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_notes !== undefined ? { event_notes: a.event_notes } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_url !== undefined ? { event_url: a.event_url } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_push_enabled !== undefined ? { event_push_enabled: a.event_push_enabled } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_push_offsets !== undefined ? { event_push_offsets: a.event_push_offsets as unknown as Json } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_push_at !== undefined ? { event_push_at: a.event_push_at } as any : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(a.event_repeat !== undefined ? { event_repeat: a.event_repeat as unknown as Json } as any : {}),
  };
}

function appointmentToUpdate(patch: Partial<Appointment>): Update {
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
  if (patch.paid_amount !== undefined) out.paid_amount = patch.paid_amount;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.address_note !== undefined) out.address_note = patch.address_note;
  if (patch.address_lat !== undefined) out.address_lat = patch.address_lat;
  if (patch.address_lng !== undefined) out.address_lng = patch.address_lng;
  if (patch.cancel_reason !== undefined) out.cancel_reason = patch.cancel_reason;
  if (patch.source !== undefined) out.source = patch.source;
  if (patch.is_online_booking !== undefined)
    out.is_online_booking = patch.is_online_booking;
  if (patch.consent_given !== undefined) out.consent_given = patch.consent_given;
  if (patch.color_override !== undefined)
    out.color_override = patch.color_override;
  if (patch.reminder_enabled !== undefined)
    out.reminder_enabled = patch.reminder_enabled;
  if (patch.reminder_template !== undefined)
    out.reminder_template = patch.reminder_template;
  if (patch.total_duration !== undefined)
    out.total_duration = patch.total_duration;

  // Nested — REPLACED ATOMICALLY (see header).
  if (patch.reminder_offsets !== undefined)
    out.reminder_offsets = patch.reminder_offsets as unknown as Json;
  if (patch.service_ids !== undefined)
    out.service_ids = patch.service_ids as unknown as Json;
  if (patch.services !== undefined)
    out.services = patch.services as unknown as Json;
  if (patch.service_price_overrides !== undefined)
    out.service_price_overrides = patch.service_price_overrides as unknown as Json;
  if (patch.expenses !== undefined)
    out.expenses = patch.expenses as unknown as Json;
  if (patch.payments !== undefined)
    out.payments = patch.payments as unknown as Json;
  if (patch.payment !== undefined)
    out.payment = patch.payment as unknown as Json | null;
  // STORY-049 — patch.photos is intentionally ignored; the column
  // doesn't exist anymore. PhotoBlock writes via the dedicated repo.
  if (patch.global_discount !== undefined)
    out.global_discount = patch.global_discount as unknown as Json | null;
  // v665 — event_* fields. Indexed cast so older Supabase deploys
  // without the columns gracefully skip via the 42703 retry below.
  if (patch.event_all_day !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_all_day = patch.event_all_day;
  if (patch.event_notes !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_notes = patch.event_notes;
  if (patch.event_url !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_url = patch.event_url;
  if (patch.event_push_enabled !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_push_enabled = patch.event_push_enabled;
  if (patch.event_push_offsets !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_push_offsets = patch.event_push_offsets;
  if (patch.event_push_at !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_push_at = patch.event_push_at;
  if (patch.event_repeat !== undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).event_repeat = patch.event_repeat;
  return out;
}

/** v665 — strip event_* columns from a payload when the DB returns
 *  42703 (column does not exist). Keeps older Supabase deploys
 *  compatible; the localStorage path still carries the data, so a
 *  user can edit on the same device, just not cross-sync. */
function stripEventFields<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = { ...payload };
  for (const key of [
    "event_all_day",
    "event_notes",
    "event_url",
    "event_push_enabled",
    "event_push_offsets",
    "event_push_at",
    "event_repeat",
  ] as const) {
    delete out[key];
  }
  return out as T;
}

// ─── Public API ────────────────────────────────────────────────

/** Fetch every appointment for the tenant. STORY-049 — the photos
 *  column was dropped, so the result no longer carries blob data. */
export async function listAppointments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Appointment[]> {
  const { data: rows, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`listAppointments: ${error.message}`);
  return (rows ?? []).map((r) => rowToAppointment(r));
}

/** Single appointment by id. Photos NOT included — caller fetches
 *  them via listPhotosForAppointment (STORY-049 decision A9). */
export async function getAppointment(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<Appointment | null> {
  const { data: row, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`getAppointment: ${error.message}`);
  if (!row) return null;
  return rowToAppointment(row);
}

export async function createAppointment(
  supabase: DbSupabase,
  input: Appointment,
  tenantId: string,
): Promise<Appointment> {
  const ins = appointmentToInsert(input, tenantId);
  const first = await supabase
    .from("appointments")
    .insert(ins)
    .select("*")
    .single();
  // v665 — graceful fallback for older Supabase deploys missing the
  // event_* columns. Strip them and retry once; localStorage still
  // carries the data so the user's edits aren't lost.
  if (first.error && isMissingEventColumn(first.error)) {
    const retry = await supabase
      .from("appointments")
      .insert(stripEventFields(ins) as typeof ins)
      .select("*")
      .single();
    if (retry.error) throw new Error(`createAppointment: ${retry.error.message}`);
    return rowToAppointment(retry.data);
  }
  if (first.error) throw new Error(`createAppointment: ${first.error.message}`);
  return rowToAppointment(first.data);
}

/** Match the Supabase error shape that indicates a missing column
 *  in the appointments table. Used by the graceful-fallback retry. */
function isMissingEventColumn(error: { code?: string; message?: string }): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = (error as any).code;
  const msg = String(error.message ?? "").toLowerCase();
  if (code === "42703") return true;
  return /event_(all_day|notes|url|push_enabled|push_offsets|push_at|repeat)/i.test(msg);
}

/**
 * Patch top-level columns. Nested arrays / objects in the patch are
 * REPLACED ATOMICALLY (no merge). To add one item, the caller must
 * pass the full updated array.
 */
export async function updateAppointment(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Appointment>,
  tenantId: string,
): Promise<Appointment> {
  const upd = appointmentToUpdate(patch);
  const { data: row, error } = await supabase
    .from("appointments")
    .update(upd)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error && isMissingEventColumn(error)) {
    // v665 — graceful fallback (see createAppointment).
    const retry = await supabase
      .from("appointments")
      .update(stripEventFields(upd) as typeof upd)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (retry.error) throw new Error(`updateAppointment: ${retry.error.message}`);
    return rowToAppointment(retry.data);
  }
  if (error) throw new Error(`updateAppointment: ${error.message}`);
  return rowToAppointment(row);
}

export async function deleteAppointment(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("appointments")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `deleteAppointment: ${error?.message ?? "заявка не найдена или недоступна"}`,
    );
  }
}
