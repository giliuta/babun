import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { FinanceTransaction } from "../../local/finance/transaction";
import { rowToTx } from "./finance-transactions";

// «УДАЛЁННЫЕ ОПЕРАЦИИ» (владелец 03.10; миграция 20261003224700).
//
// Удалённая операция уходит из журнала целиком, а её снимок 30 дней лежит в
// `deleted_operations`. Лента, остатки и аналитика ящика не читают — для них
// операции нет. Отсюда её возвращают («Вернуть» — та же строка с тем же id)
// или стирают насовсем. Кто что видит, решает RLS ящика: владелец — всё,
// партнёр — то, что удалил сам, там, где и сейчас может это править.

type DbSupabase = SupabaseClient<Database>;
type TxRow = Database["public"]["Tables"]["finance_transactions"]["Row"];

export interface DeletedOperation {
  id: string;
  teamId: string;
  deletedAt: string;
  /** Когда снимок сотрёт ночная очистка. */
  purgeAt: string;
  deletedBy: string | null;
  /** Операция, какой она была в миг удаления. */
  transaction: FinanceTransaction;
}

/** Ящик компании, свежие сверху; с `teamId` — только эта команда. */
export async function listDeletedOperations(
  supabase: DbSupabase,
  tenantId: string,
  teamId?: string | null,
): Promise<DeletedOperation[]> {
  let q = supabase
    .from("deleted_operations")
    .select("id, team_id, deleted_at, purge_at, deleted_by, operation")
    .eq("tenant_id", tenantId);
  if (teamId) q = q.eq("team_id", teamId);
  const { data, error } = await q.order("deleted_at", { ascending: false });
  if (error) throw new Error(`listDeletedOperations: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    deletedAt: row.deleted_at,
    purgeAt: row.purge_at,
    deletedBy: row.deleted_by,
    // Снимок — `to_jsonb` строки журнала: те же поля, что у живой строки.
    transaction: rowToTx(row.operation as unknown as TxRow),
  }));
}

/** «Вернуть»: операция снова в журнале с тем же id. Отказ сервера (счёт
 *  операции удалён, нет права) доходит текстом. */
export async function restoreDeletedOperation(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("restore_deleted_operation", { p_id: id });
  if (error || !data) {
    throw new Error(error?.message || "Операции нет в «Удалённых»");
  }
}

/** «Удалить насовсем» — снимок стирается раньше срока. */
export async function eraseDeletedOperation(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("deleted_operations")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message || "Операции нет в «Удалённых»");
  }
}
