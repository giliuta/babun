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


import type { Appointment } from "../../local/appointments";
import {
  appointmentToInsert,
  appointmentToUpdate,
  rowToAppointment,
  type DbSupabase,
  type Row,
} from "./appointments/rows";

export { appointmentToUpdate, rowToAppointment } from "./appointments/rows";

// ─── Public API ────────────────────────────────────────────────

// PostgREST caps every response at `max_rows` (Supabase default 1000) and
// says nothing about the rows it dropped. This list feeds the authoritative
// cache resync (`cacheReplaceTenant`), which DELETES every cached row missing
// from the snapshot — so a capped read would silently erase the tenant's
// appointments past the cap from the device calendar. Same paging as
// clients (`listClientRows`). The page must not exceed the server cap: a
// short page is read as the last one.
const APPOINTMENT_PAGE_SIZE = 1000;

/** Fetch every appointment for the tenant, page by page (stable order by
 *  primary key, so no row is skipped or repeated across pages). STORY-049 —
 *  the photos column was dropped, so the result carries no blob data. */
export async function listAppointments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Appointment[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += APPOINTMENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(offset, offset + APPOINTMENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listAppointments: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < APPOINTMENT_PAGE_SIZE) break;
  }
  return rows.map((r) => rowToAppointment(r));
}

/** DELTA — rows changed after `sinceIso` (`updated_at >`), paged in a stable
 *  (updated_at, id) order. Feeds the incremental resync
 *  (`appointmentsCached/incremental.ts`); deletions are NOT here — the month
 *  digest catches those. */
export async function listAppointmentsChangedSince(
  supabase: DbSupabase,
  tenantId: string,
  sinceIso: string,
): Promise<Appointment[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += APPOINTMENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("tenant_id", tenantId)
      .gt("updated_at", sinceIso)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + APPOINTMENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listAppointmentsChangedSince: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < APPOINTMENT_PAGE_SIZE) break;
  }
  return rows.map((r) => rowToAppointment(r));
}

/** Rows whose `date` (text «YYYY-MM-DD») lies in [from, to], paged by id.
 *  A diverged digest month is re-read with it; the first load reads the
 *  window around today with it before the full history. */
export async function listAppointmentsInDateRange(
  supabase: DbSupabase,
  tenantId: string,
  from: string,
  to: string,
): Promise<Appointment[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += APPOINTMENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("date", from)
      .lte("date", to)
      .order("id", { ascending: true })
      .range(offset, offset + APPOINTMENT_PAGE_SIZE - 1);
    if (error) throw new Error(`listAppointmentsInDateRange: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < APPOINTMENT_PAGE_SIZE) break;
  }
  return rows.map((r) => rowToAppointment(r));
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
  const { data, error } = await supabase
    .from("appointments")
    .insert(ins)
    .select("*")
    .single();
  if (error) throw new Error(`createAppointment: ${error.message}`);
  return rowToAppointment(data);
}

/** Запись изменилась на сервере после того, как телефон её видел, а правка
 *  трогает статус или деньги — её не применили. `fresh` —
 *  строка сервера, чтобы экран сразу показал правду. */
export class StaleAppointmentError extends Error {
  constructor(readonly fresh: Appointment | null) {
    super(
      "updateAppointment: Запись изменилась на другом устройстве — проверьте её и повторите",
    );
    this.name = "StaleAppointmentError";
  }
}

/** Записи на сервере больше нет — её удалили на другом устройстве, пока
 *  этот телефон её показывал : правка находит ноль
 *  строк. Это не общее «Не удалось…» — иначе запись оставалась бы на
 *  экране. */
export class GoneAppointmentError extends Error {
  constructor() {
    super("updateAppointment: Этой записи больше нет — её удалили на другом устройстве");
    this.name = "GoneAppointmentError";
  }
}

/**
 * Patch top-level columns. Nested arrays / objects in the patch are
 * REPLACED ATOMICALLY (no merge). To add one item, the caller must
 * pass the full updated array.
 *
 * `expectedUpdatedAt` — правка ляжет, только если строка не менялась с тех
 * пор (статус и деньги, см. `APPOINTMENT_GUARDED_FIELDS`); иначе
 * `StaleAppointmentError` со строкой сервера.
 */
export async function updateAppointment(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Appointment>,
  tenantId: string,
  opts: { expectedUpdatedAt?: string | null } = {},
): Promise<Appointment> {
  const upd = appointmentToUpdate(patch);
  if (opts.expectedUpdatedAt) {
    const guarded = await supabase
      .from("appointments")
      .update(upd)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("updated_at", opts.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (guarded.error) throw new Error(`updateAppointment: ${guarded.error.message}`);
    if (!guarded.data) {
      throw new StaleAppointmentError(await getAppointment(supabase, id, tenantId).catch(() => null));
    }
    return rowToAppointment(guarded.data);
  }
  const { data: row, error } = await supabase
    .from("appointments")
    .update(upd)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error && (error as { code?: string }).code === "PGRST116") {
    throw new GoneAppointmentError();
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
