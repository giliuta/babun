// Outgoing-write queue (`sync_queue`).

import type { SqlAdapter } from "../../../storage/sql/types";
import type { CachedTable, QueuedOp } from "../index";
import { bumpLocalWrite, ready } from "./connection";
import { deleteRow, upsertRow } from "./rows";
import type { CachedRow } from "./types";

type QueueRow = {
  id: number;
  created_at: number;
  table_name: string;
  op: string;
  row_id: string;
  payload: string;
  expected_updated_at: string | null;
  attempts: number;
  last_error: string | null;
};

/** Map a `QueuedOp.table` (cache vocab) to its DB column value. Stored
 *  in `sync_queue.table_name` (the column is named table_name because
 *  `table` is a SQL keyword). */
function queueRowToOp(row: QueueRow): QueuedOp {
  const op: QueuedOp = {
    id: row.id,
    created_at: row.created_at,
    table: row.table_name as CachedTable,
    op: row.op as QueuedOp["op"],
    row_id: row.row_id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    expected_updated_at: row.expected_updated_at,
    attempts: row.attempts,
  };
  // Only attach last_error when present — the web `QueuedOp` leaves it
  // absent (not `undefined`) so equality/serialisation matches.
  if (row.last_error != null) op.last_error = row.last_error;
  return op;
}

/** Insert a queued op with no id (AUTOINCREMENT assigns it) and no
 *  created_at/attempts (defaulted here, matching the web cache). */
export async function enqueueOp(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  const sql = await ready();
  await insertOp(sql, op);
}

async function insertOp(
  sql: SqlAdapter,
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  await sql.runAsync(
    `INSERT INTO sync_queue
       (created_at, table_name, op, row_id, payload, expected_updated_at, attempts, last_error)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [
      Date.now(),
      op.table,
      op.op,
      op.row_id,
      JSON.stringify(op.payload),
      op.expected_updated_at,
    ],
  );
}

/** ATOMIC enqueue + optimistic cache upsert (offline-plan risk #6). The
 *  web cache leaves these as two separate calls; on SQLite we can — and
 *  must — run them in one EXCLUSIVE transaction so (a) a crash between them
 *  can't leave an optimistic row with no queued op (or vice-versa), and
 *  (b) a concurrent write can't interleave into the pair. Not part of the
 *  web IndexedDB surface; the shared cached-wrappers (slice 3/4) call THIS
 *  on the offline path instead of `enqueueOp` + `cacheUpsert`.
 *
 *  NOTE — this bypasses queue-events' emitQueueChange (it lives one layer
 *  up). Callers that need the queue badge to update immediately go through
 *  `enqueueOpWithCacheUpsertAndEmit` in ./queue-events (which emits after
 *  this resolves); the 5 s safety poll is the fallback either way. */
export async function enqueueOpWithCacheUpsert<T extends CachedRow>(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  row: T,
): Promise<void> {
  bumpLocalWrite(table);
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await upsertRow(txn, table, row);
    await insertOp(txn, op);
  });
}

/** ATOMIC enqueue + optimistic cache DELETE (offline-plan risk #6, delete
 *  side). Same rationale as enqueueOpWithCacheUpsert: the optimistic
 *  cacheDelete and the queued 'delete' op must land together or not at all,
 *  isolated from concurrent writers. Emit is handled one layer up (see
 *  enqueueOpWithCacheDeleteAndEmit in ./queue-events). */
export async function enqueueOpWithCacheDelete(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  id: string,
): Promise<void> {
  bumpLocalWrite(table);
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await deleteRow(txn, table, id);
    await insertOp(txn, op);
  });
}

/** Drain the entire queue ordered by `created_at` ASC (then id ASC as a
 *  stable tiebreak for ops enqueued in the same millisecond — the web
 *  IDB index sorts by created_at only, but its insertion-ordered key
 *  makes ties FIFO too; the explicit id tiebreak reproduces that). */
export async function dequeueAll(): Promise<QueuedOp[]> {
  const sql = await ready();
  const rows = await sql.getAllAsync<QueueRow>(
    `SELECT id, created_at, table_name, op, row_id, payload,
            expected_updated_at, attempts, last_error
       FROM sync_queue
       -- ПОРЯДОК ПОСТАНОВКИ, А НЕ ЧАСЫ ТЕЛЕФОНА. id —
       -- AUTOINCREMENT и растёт строго по порядку записи; created_at — Date.now()
       -- и ходит назад вместе с часами (ручная смена времени, коррекция после
       -- долгого офлайна): удаление вставало перед вставкой той же записи,
       -- давало «0 строк = уже удалено», а вставка затем её воскрешала.
       ORDER BY id ASC`,
  );
  return rows.map(queueRowToOp);
}

/** Есть ли в очереди НЕОТПРАВЛЕННЫЕ правки этой строки. Прямая запись в
 *  сеть мимо них обгоняет их: старая правка долетит ПОСЛЕ свежей и
 *  перезапишет её (пример: растяжка 14:30→15:00 легла в очередь на 504, возврат
 *  к 14:30 ушёл напрямую, потом очередь дослала 15:00). */
export async function hasQueuedOps(
  table: CachedTable,
  rowId: string,
): Promise<boolean> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue WHERE table_name = ? AND row_id = ?",
    [table, rowId],
  );
  return (row?.n ?? 0) > 0;
}

/** Лежит ли у строки правка, которую очередь уже не повторит сама
 *  (`attempts >= minAttempts`): всё, что встанет за ней, тоже не уйдёт, пока
 *  человек её не повторит или не удалит в «Синхронизации». */
export async function hasStuckQueuedOps(
  table: CachedTable,
  rowId: string,
  minAttempts: number,
): Promise<boolean> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue WHERE table_name = ? AND row_id = ? AND attempts >= ?",
    [table, rowId, minAttempts],
  );
  return (row?.n ?? 0) > 0;
}

export async function removeOp(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
}

/** СВЕЖИЙ СТОРОЖ ДЛЯ СЛЕДУЮЩИХ ПРАВОК СТРОКИ.
 *
 *  Все офлайн-правки одной строки встают в очередь с одним и тем же
 *  `expected_updated_at` — тем, что был в кэше. Первая применилась, триггер
 *  сервера поставил строке новое `updated_at`, и вторая с прежним сторожем
 *  находила ноль строк: ложный «Конфликт синхронизации» и силовая запись.
 *  Применившаяся правка передаёт свежий сторож тем, кто ждёт за ней. */
export async function forwardQueuedSentinel(
  table: CachedTable,
  rowId: string,
  afterId: number,
  from: string,
  to: string,
): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE sync_queue SET expected_updated_at = ? WHERE table_name = ? AND row_id = ? AND id > ? AND expected_updated_at = ?",
    [to, table, rowId, afterId, from],
  );
}

export async function bumpAttempt(id: number, error: string): Promise<void> {
  const sql = await ready();
  // Match the web semantics: increment attempts, set last_error. A
  // missing row is a silent no-op (web reads-then-writes; the UPDATE …
  // WHERE id form is equivalent and skips the read).
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
    [error, id],
  );
}

/** Force an op's attempts to a high sentinel (999) so the replayer's
 *  `attempts >= MAX_ATTEMPTS` skip fires immediately, while keeping the
 *  row + last_error for the queue panel. Port of the web
 *  markOpPermanentlyFailed path (which lives in queue-events on web). */
export async function markOpPermanentlyFailed(
  id: number,
  error: string,
): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = 999, last_error = ? WHERE id = ?",
    [error, id],
  );
}

/** Manual-retry reset: attempts → 0 and clear last_error. Port of the
 *  web resetOpAttempts path. */
export async function resetOpAttempts(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = 0, last_error = NULL WHERE id = ?",
    [id],
  );
}

export async function queueDepth(): Promise<number> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue",
  );
  return row?.n ?? 0;
}
