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
  const map: DayCityMap = {};
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("day_cities")
      .select("team_id, date, city")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true })
      .order("team_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`listDayCities: ${error.message}`);
    const page = (data ?? []) as Pick<Row, "team_id" | "date" | "city">[];
    for (const row of page) {
      map[dayCityKey(row.team_id, row.date)] = row.city;
    }
    if (page.length < pageSize) break;
  }
  return map;
}

/** Один явный override team+date — точечное чтение без полной карты
 *  (автоприсвоение метки клиенту при записи). null = строки нет; может
 *  вернуть сентинел CITY_CLEARED — нормализация на вызывающем. */
export async function fetchDayCity(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
  date: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("day_cities")
    .select("city")
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`fetchDayCity: ${error.message}`);
  return data?.city ?? null;
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

/** Bulk-rename a label across every day assignment of the tenant —
 *  day_cities stores plain names, so a library rename must cascade
 *  here or old assignments silently orphan (grey ghost labels). */
/** ПЕРЕИМЕНОВАНИЕ — ТОЛЬКО В СВОЕЙ КОМАНДЕ (2026-08-29).
 *
 *  С тех пор как метка принадлежит команде (`cities.team_id`), одноимённые
 *  метки в разных календарях — РАЗНЫЕ метки. Правка по одному лишь имени
 *  переименовала бы дни всех команд разом: диспетчер правит «Лимассол» у
 *  своей бригады, а уезжает он у трёх чужих. */
export async function renameDayCity(
  supabase: DbSupabase,
  tenantId: string,
  teamId: string,
  from: string,
  to: string,
): Promise<void> {
  const { error } = await supabase
    .from("day_cities")
    .update({ city: to })
    .eq("tenant_id", tenantId)
    .eq("team_id", teamId)
    .eq("city", from);
  if (error) throw new Error(`renameDayCity: ${error.message}`);
}
