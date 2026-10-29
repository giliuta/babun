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

/** Пачка больше пятисот уходит ПОРЦИЯМИ по пятьсот, одна за другой, и итог
 *  складывается. Отказ первой порции — отказ всей пачки (ничего не
 *  изменено); отказ поздней — уже изменённое остаётся, а не дошедшие до
 *  сервера считаются пропущенными: «изменено 500, пропущено 120» честнее,
 *  чем «не удалось» при половине сделанного. */
export async function bulkEditOnServer(
  tenantId: string,
  edits: readonly BulkEdit[],
): Promise<BulkEditOutcome> {
  if (edits.length === 0) return { kind: "done", result: { changed: [], skipped: 0, unchanged: 0 } };
  if (!isOnline()) return { kind: "offline" };
  const total: BulkEditResult = { changed: [], skipped: 0, unchanged: 0 };
  for (let from = 0; from < edits.length; from += BATCH_LIMIT) {
    const part = await bulkEditPart(tenantId, edits.slice(from, from + BATCH_LIMIT));
    if (part.kind !== "done") {
      if (from === 0) return part;
      return { kind: "done", result: { ...total, skipped: total.skipped + edits.length - from } };
    }
    total.changed.push(...part.result.changed);
    total.skipped += part.result.skipped;
    total.unchanged += part.result.unchanged;
  }
  return { kind: "done", result: total };
}

async function bulkEditPart(
  tenantId: string,
  edits: readonly BulkEdit[],
): Promise<BulkEditOutcome> {
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
