// Fresh `updated_at` sentinel after a write landed: hand it to the queued
// edits of the same row and to the cached row.

import {
  cacheGetOne,
  cacheUpsert,
  forwardQueuedSentinel,
  type CachedAppointmentData,
  type CachedClientData,
  type CachedTable,
  type QueuedOp,
} from "../../db/cache/sql";

/** Строка на сервере получила новое `updated_at`. Ждущие правки, у которых
 *  сторожем стоит прежнее значение, и строка кэша должны знать новое —
 *  колбэк слива передаёт его правкам этого же прохода. `from` — прежний
 *  сторож, если колбэку нужен не `expected_updated_at` самой операции. */
export type AppliedFn = (updatedAt: string, from?: string) => void;

/** Передать свежий сторож ждущим правкам строки и строке кэша. Сбой здесь
 *  правку не отменяет — она уже на сервере; худшее — прежний ложный
 *  «конфликт» у следующей. */
export async function carrySentinel(op: QueuedOp, from: string, to: string): Promise<void> {
  try {
    await forwardQueuedSentinel(op.table, op.row_id, op.id, from, to);
    const cached = await cacheGetOne<CachedClientData | CachedAppointmentData>(
      op.table as CachedTable,
      op.row_id,
    );
    const stamp = (cached as { updated_at?: unknown } | null)?.updated_at;
    if (cached && stamp === from) {
      await cacheUpsert(op.table as CachedTable, { ...cached, updated_at: to });
    }
  } catch {
    /* см. выше */
  }
}
