// One queued op → PostgREST, routed by op kind.

import type { QueuedOp } from "../../db/cache/sql";
import type { DbSupabase } from "./relay";
import type { AppliedFn } from "./sentinel";
import { replayDelete } from "./replay-delete";
import { replayInsert } from "./replay-insert";
import { replayUpdate } from "./replay-update";
import { tableForOp } from "./table-rules";

/** Returns `true` if the dispatch succeeded but a conflict was
 *  detected (UPDATE matched 0 rows on the first pass; we then
 *  retried without expected_updated_at and that one succeeded).
 *  `"server-won"` — правка статуса или денег записи при конфликте уступила
 *  серверу (`APPOINTMENT_GUARDED_FIELDS`): о ней надо сказать словами.
 *  `"server-newer"` — правка записи или клиента уступила строке, которую
 *  изменили на сервере позже (`serverNewerWins`).
 *  Throws on unrecoverable errors so the caller bumps attempts. */
export async function dispatch(
  supabase: DbSupabase,
  op: QueuedOp,
  /** Правка старого образца (без компании в теле, см. гейт в `drain`). Она
   *  пролежала в очереди часы и дни, и строку за это время правили — при
   *  конфликте побеждает сервер, а не она. */
  serverWinsOnConflict = false,
  /** Правка легла чисто, и у строки теперь новое `updated_at`. */
  onApplied?: AppliedFn,
  /** Компания устройства всё ещё та, под которой начат слив. */
  tenantStill?: () => boolean,
): Promise<boolean | "server-won" | "server-newer"> {
  // The repositories accept the row shapes already; payloads are
  // pre-shaped at enqueue time so dispatch is mostly a relay. We
  // talk directly to PostgREST here (not through the typed repo
  // helpers) because:
  //   1. Each table has a different repo function signature; a
  //      generic relay keeps the replayer table-agnostic.
  //   2. The conflict-detection pattern (UPDATE WHERE updated_at)
  //      is uniform across tables.
  const tableName = tableForOp(op.table);

  if (op.op === "delete") {
    return replayDelete(supabase, op, tableName, tenantStill);
  }
  if (op.op === "insert") {
    return replayInsert(supabase, op, tableName, onApplied);
  }
  return replayUpdate(
    supabase,
    op,
    tableName,
    serverWinsOnConflict,
    onApplied,
    tenantStill,
  );
}
