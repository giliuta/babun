// Generic PostgREST relay plumbing shared by the per-kind replay modules.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import type { AppliedFn } from "./sentinel";

export type DbSupabase = SupabaseClient<Database>;

/** The queue stores payloads as plain JSON and picks the table at run time,
 *  so no static row type exists for a relayed write. This view of the client
 *  erases the per-table types for those writes — the only place in the
 *  replayer that does. Reads keep the typed client. */
export function relayClient(supabase: DbSupabase): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

/** DB table a queued op targets (see `tableForOp`). */
export type ReplayTable = "clients" | "appointments" | "client_tags";

/** An insert payload after table rules ran. `aggregate` set — the table
 *  replays the insert itself and the generic relay must not touch it. */
export interface PreparedInsert {
  payload: Record<string, unknown>;
  aggregate: ((supabase: DbSupabase, onApplied?: AppliedFn) => Promise<void>) | null;
}

/** НОЛЬ СТРОК ДВУСМЫСЛЕН, и разрешает его только чтение видимости: строки не
 *  видно — её удалили с другого устройства (или не было), строка ВИДНА —
 *  сервер отказал именно в этой операции. Ошибка самого чтения — не «не
 *  видно»: гадать нельзя, операция остаётся до следующей попытки, иначе обрыв
 *  сети молча выбросил бы правку или удаление. */
export async function rowStillVisible(
  supabase: DbSupabase,
  tableName: ReplayTable,
  rowId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(tableName)
    .select("id")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(`replay visibility check: ${error.message}`);
  return data != null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
