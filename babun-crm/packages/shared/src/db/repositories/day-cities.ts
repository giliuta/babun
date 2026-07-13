// Day cities repository — STORY-044.
//
// Normalised: one row per (tenant_id, team_id, date). The local UI
// shape is `Record<"<teamId>:<YYYY-MM-DD>", string>`, so the
// adapters collapse rows back to that map on read.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { DayCityMap } from "../../local/day-cities";
import { dayCityKey } from "../../local/day-cities";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["day_cities"]["Row"];

export async function listDayCities(
  supabase: DbSupabase,
  tenantId: string,
): Promise<DayCityMap> {
  const { data, error } = await supabase
    .from("day_cities")
    .select("team_id, date, city")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`listDayCities: ${error.message}`);
  const map: DayCityMap = {};
  for (const r of (data ?? []) as Pick<Row, "team_id" | "date" | "city">[]) {
    map[dayCityKey(r.team_id, r.date)] = r.city;
  }
  return map;
}

/** Upsert one assignment. Empty/whitespace city deletes the row,
 *  matching the local-shape semantic in `setDayCity`. */
export async function setDayCity(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
  date: string,
  city: string,
): Promise<void> {
  const trimmed = city.trim();
  if (trimmed === "") {
    const { error } = await supabase
      .from("day_cities")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("team_id", teamId)
      .eq("date", date);
    if (error) throw new Error(`setDayCity (delete): ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from("day_cities")
    .upsert(
      { tenant_id: tenantId, team_id: teamId, date, city: trimmed },
      { onConflict: "tenant_id,team_id,date" },
    );
  if (error) throw new Error(`setDayCity (upsert): ${error.message}`);
}

export async function clearDayCity(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
  date: string,
): Promise<void> {
  await setDayCity(supabase, tenantId, teamId, date, "");
}

/** Bulk-rename a label across every day assignment of the tenant —
 *  day_cities stores plain names, so a library rename must cascade
 *  here or old assignments silently orphan (grey ghost labels). */
export async function renameDayCity(
  supabase: DbSupabase,
  tenantId: string,
  from: string,
  to: string,
): Promise<void> {
  const { error } = await supabase
    .from("day_cities")
    .update({ city: to })
    .eq("tenant_id", tenantId)
    .eq("city", from);
  if (error) throw new Error(`renameDayCity: ${error.message}`);
}
