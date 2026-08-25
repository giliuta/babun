// Recurring reminders repository — STORY-050.
//
// Lift-and-shift of @babun/shared/local/recurring.ts. The HVAC follow-up
// reminder inbox: "we cleaned the A/C six months ago, time to call
// back". Each row is a single-shot reminder; no RRULE engine, no
// occurrence generation.
//
// Adapters round-trip the local `RecurringReminder` shape verbatim.
// `client_name` and `phone` are denormalised on the row so deleting a
// client doesn't drop the reminder (FK is `on delete set null`).
//
// RLS gates everything by `tenant_id = current_tenant_id()`. The
// explicit `.eq('tenant_id', tenantId)` filters below are redundant
// for security but pin PostgREST to the tenant index.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type {
  CreateRecurringInput,
  RecurringReminder,
  RecurringStatus,
} from "../../local/recurring";
import { addMonthsYYYYMMDD } from "../../local/recurring";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["recurring_reminders"]["Row"];
type Insert = Database["public"]["Tables"]["recurring_reminders"]["Insert"];

// ─── Adapters ─────────────────────────────────────────────────────────

function rowToReminder(r: Row): RecurringReminder {
  // P0 #19 (CRM Core brief) — `type`, `manual`, `notify_channel`
  // columns added in 20260517_002. The generated `Row` type catches
  // up next time `supabase gen types` runs; until then we read the
  // values via a cast so the round-trip is symmetric with the new
  // writer below.
  const x = r as Row & {
    type?: string;
    manual?: boolean;
    notify_channel?: string;
  };
  return {
    id: r.id,
    client_id: r.client_id ?? "",
    client_name: r.client_name,
    phone: r.phone,
    team_id: r.team_id ?? null,
    service_ids: Array.isArray(r.service_ids)
      ? (r.service_ids as string[])
      : [],
    service_summary: r.service_summary,
    last_date: r.last_date,
    next_due_date: r.next_due_date,
    interval_months: r.interval_months,
    status: r.status as RecurringStatus,
    note: r.note,
    type: (x.type as RecurringReminder["type"]) ?? undefined,
    manual: x.manual ?? undefined,
    notify_channel: (x.notify_channel as RecurringReminder["notify_channel"]) ?? undefined,
    created_at: r.created_at,
  };
}

function inputToInsert(
  tenantId: string,
  input: CreateRecurringInput
): Insert {
  // P0 #19 — manual-reminder fields. Cast until `supabase gen types`
  // catches up with the 20260517_002 migration; the DB carries
  // sensible defaults so undefined values are equivalent to «server
  // picks», not «null override».
  const base: Insert = {
    tenant_id: tenantId,
    client_id: input.client_id || null,
    client_name: input.client_name,
    phone: input.phone ?? "",
    team_id: input.team_id ?? null,
    service_ids: input.service_ids,
    service_summary: input.service_summary,
    last_date: input.last_date,
    next_due_date: addMonthsYYYYMMDD(input.last_date, input.interval_months),
    interval_months: input.interval_months,
    status: "pending",
    note: input.note ?? "",
  };
  if (input.type !== undefined) {
    (base as Insert & { type?: string }).type = input.type;
  }
  if (input.manual !== undefined) {
    (base as Insert & { manual?: boolean }).manual = input.manual;
  }
  if (input.notify_channel !== undefined) {
    (base as Insert & { notify_channel?: string }).notify_channel = input.notify_channel;
  }
  return base;
}

// ─── Public API ───────────────────────────────────────────────────────

/** All reminders for the current tenant, sorted by next_due_date asc. */
export async function listRecurringReminders(
  supabase: DbSupabase,
  tenantId: string
): Promise<RecurringReminder[]> {
  const { data, error } = await supabase
    .from("recurring_reminders")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("next_due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToReminder);
}

export async function createRecurringReminder(
  supabase: DbSupabase,
  tenantId: string,
  input: CreateRecurringInput
): Promise<RecurringReminder> {
  const { data, error } = await supabase
    .from("recurring_reminders")
    .insert(inputToInsert(tenantId, input))
    .select("*")
    .single();
  if (error) throw error;
  return rowToReminder(data);
}

/** Mark a reminder as `pending | booked | dismissed`. Used for the
 *  inbox actions on /dashboard/recurring (Записано / X). */
export async function updateReminderStatus(
  supabase: DbSupabase,
  id: string,
  status: RecurringStatus
): Promise<void> {
  const { data, error } = await supabase
    .from("recurring_reminders")
    .update({ status })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Напоминание не найдено или доступ запрещён.");
}

/** Hard delete. The X button on the inbox is destructive (the
 *  `dismissed` status already covers "leave it but hide"). */
export async function deleteRecurringReminder(
  supabase: DbSupabase,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from("recurring_reminders")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Напоминание не найдено или доступ запрещён.");
}
