import { isOnline } from "@babun/shared/sync";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { parseBulkEditResult, type BulkEdit, type BulkEditResult } from "./bulk-edit";

// ПАЧКА — ОДНИМ ВЫЗОВОМ СЕРВЕРА (`bulk_edit_clients`).
//
// Очередь правок карточки тут не помощник: теги в неё не ложатся вовсе
// (связующую таблицу она не несёт), а команда меняется только своей дверью
// сервера. Поэтому без сети пачка честно отказывает, а не делает вид, что
// «сохранит потом».
//
// Пока функции на сервере нет, PostgREST отвечает `PGRST202`, сам Postgres —
// `42883`: это отдельный отказ «появится после обновления», а не «ошибка».

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

type BulkRpc = {
  rpc: (
    name: "bulk_edit_clients",
    args: { p_edits: BulkEdit[] },
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export type BulkEditOutcome =
  | { kind: "done"; result: BulkEditResult }
  | { kind: "offline" }
  | { kind: "not_deployed" }
  | { kind: "failed"; error: unknown };

/** Сервер принимает не больше пятисот клиентов за раз. */
const BATCH_LIMIT = 500;

export async function bulkEditOnServer(
  tenantId: string,
  edits: readonly BulkEdit[],
): Promise<BulkEditOutcome> {
  if (edits.length === 0) return { kind: "done", result: { changed: [], skipped: 0, unchanged: 0 } };
  if (!isOnline()) return { kind: "offline" };
  if (edits.length > BATCH_LIMIT) {
    return { kind: "failed", error: new Error(`За раз — не больше ${BATCH_LIMIT} клиентов`) };
  }
  // Клиент, привязанный к компании списка: чужая компания, открытая в
  // календаре, не должна получить эту пачку своим заголовком.
  const rpc = tenantBoundClient(tenantId) as unknown as BulkRpc;
  try {
    const { data, error } = await rpc.rpc("bulk_edit_clients", { p_edits: [...edits] });
    if (error) {
      if (error.code && MISSING_FUNCTION.has(error.code)) return { kind: "not_deployed" };
      return { kind: "failed", error };
    }
    return { kind: "done", result: parseBulkEditResult(data) };
  } catch (error) {
    return { kind: "failed", error };
  }
}
