// Team schedules repository — STORY-044.
//
// Bridge between the local UI shape (`@babun/shared/local/schedule`
// → `ScheduleMap` keyed by team_id) and the Supabase row shape (one
// row per `(tenant_id, team_id)` with the entire `TeamSchedule` as
// jsonb). Same jsonb-heavy approach as appointments.
//
// SEMANTICS — `upsertScheduleEntry` REPLACES the schedule jsonb
// atomically. Callers that want to add a date_override or vacation
// merge in TS, then pass the full TeamSchedule. Matches STORY-042 A1.
//
// RLS — every call expects an authenticated Supabase client. The
// `tenant_id = current_tenant_id()` policy filters reads + writes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import type { ScheduleMap, TeamSchedule } from "../../local/schedule";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["team_schedules"]["Row"];

/** Fetch every team schedule for the tenant; returns the same map
 *  shape that the local layer produces, so callers can swap with no
 *  shape changes. */
export async function listScheduleEntries(
  supabase: DbSupabase,
  tenantId: string,
): Promise<ScheduleMap> {
  const { data, error } = await supabase
    .from("team_schedules")
    .select("team_id, schedule")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`listScheduleEntries: ${error.message}`);
  const map: ScheduleMap = {};
  for (const r of (data ?? []) as Pick<Row, "team_id" | "schedule">[]) {
    map[r.team_id] = (r.schedule ?? {}) as unknown as TeamSchedule;
  }
  return map;
}

/** Insert or replace the schedule for a single team. Atomic at the
 *  row level; the caller must merge nested fields client-side. */
export async function upsertScheduleEntry(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
  schedule: TeamSchedule,
): Promise<void> {
  const { error } = await supabase
    .from("team_schedules")
    .upsert(
      {
        tenant_id: tenantId,
        team_id: teamId,
        schedule: schedule as unknown as Json,
      },
      { onConflict: "tenant_id,team_id" },
    );
  if (error) throw new Error(`upsertScheduleEntry: ${error.message}`);
}

export async function deleteScheduleEntry(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
): Promise<void> {
  const { error } = await supabase
    .from("team_schedules")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId);
  if (error) throw new Error(`deleteScheduleEntry: ${error.message}`);
}
