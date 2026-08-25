// STORY-062 slice 2 — shared sync-queue change notifier + React hook.
//
// Port of apps/web/src/lib/sync/queue-events.ts. Differences from web:
//   1. Queue primitives come from the SQL cache (db/cache/sql) instead of
//      the IndexedDB cache. Same names/signatures, so producer wrappers
//      are structurally identical.
//   2. registerBackgroundSync (Service-Worker Background Sync) is DROPPED
//      — there is no SW on RN; drain happens via the NetInfo online
//      listener wired through onlineManager in query-client.ts.
//   3. `window.setInterval` → `setInterval` (no `window` global on RN;
//      the timer id type is normalised via ReturnType<typeof setInterval>).
//   4. markOpPermanentlyFailed / resetOpAttempts call the dedicated SQL
//      cache functions rather than reaching into a raw db handle
//      (getCache().get/.put), which has no SQLite analogue.
//
// SQLite HAS no native change events either, so the same tiny pub/sub +
// 5 s safety poll pattern carries over unchanged.

import { useEffect, useState } from "react";
import {
  queueDepth,
  enqueueOp,
  enqueueOpWithCacheUpsert,
  enqueueOpWithCacheDelete,
  removeOp,
  bumpAttempt,
  markOpPermanentlyFailed,
  resetOpAttempts,
  type CachedTable,
  type QueuedOp,
} from "../db/cache/sql";

// The atomic cache helpers live in the SQL cache layer (one layer below
// this pub/sub) and know nothing about emitQueueChange. Re-export their
// row types so the AndEmit shims below stay generic without the wrappers
// importing two modules.
type CachedRow = Parameters<typeof enqueueOpWithCacheUpsert>[2];

type Listener = () => void;
const listeners = new Set<Listener>();

/** Producers call this after enqueueOp / removeOp / bumpAttempt. */
export function emitQueueChange(): void {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore subscriber errors */
    }
  });
}

export function subscribeQueueChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Producer wrappers ────────────────────────────────────────────────
// Thin shims around the cache-layer queue primitives that fire the
// pub/sub event after the write succeeds. The cached wrappers + replayer
// go through THESE (not the raw cache exports) so the badge updates
// instantly without waiting for the 5 s safety poll.

export async function enqueueOpAndEmit(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  await enqueueOp(op);
  emitQueueChange();
}

/** ATOMIC optimistic upsert + enqueue (offline-plan risk #6) that also
 *  fires the queue-badge event. The cached-wrappers' offline create/update
 *  branches go through THIS so the write + the queued op land in one
 *  exclusive transaction AND the OfflineIndicator updates instantly. */
export async function enqueueOpWithCacheUpsertAndEmit<T extends CachedRow>(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  row: T,
): Promise<void> {
  await enqueueOpWithCacheUpsert(op, table, row);
  emitQueueChange();
}

/** ATOMIC optimistic delete + enqueue (offline-plan risk #6, delete side)
 *  plus the badge event. Cached-wrappers' offline delete branch uses this. */
export async function enqueueOpWithCacheDeleteAndEmit(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  id: string,
): Promise<void> {
  await enqueueOpWithCacheDelete(op, table, id);
  emitQueueChange();
}

export async function removeOpAndEmit(id: number): Promise<void> {
  await removeOp(id);
  emitQueueChange();
}

export async function bumpAttemptAndEmit(
  id: number,
  error: string,
): Promise<void> {
  await bumpAttempt(id, error);
  emitQueueChange();
}

/** Permanent-fail an op without going through MAX retries (e.g. quota
 *  exceeded). Sets attempts to a high sentinel so the replayer skips it
 *  immediately, while preserving the row + last_error for the queue
 *  panel. */
export async function markOpPermanentlyFailedAndEmit(
  id: number,
  error: string,
): Promise<void> {
  await markOpPermanentlyFailed(id, error);
  emitQueueChange();
}

/** Manual-retry from the queue panel: reset attempts + clear last_error
 *  so the next drain pass picks the op up fresh. */
export async function resetOpAttemptsAndEmit(id: number): Promise<void> {
  await resetOpAttempts(id);
  emitQueueChange();
}

const POLL_INTERVAL_MS = 5_000;

/** React hook — returns the current sync queue depth. Resubscribes on
 *  emit, plus a 5 s safety poll. Returns 0 before the first read. */
export function useQueueDepth(): number {
  const [depth, setDepth] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const n = await queueDepth();
        if (!cancelled) setDepth(n);
      } catch {
        // Cache not available yet (bootstrap race) — leave at 0.
      }
    };
    void refresh();
    const unsub = subscribeQueueChange(() => void refresh());
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);

  return depth;
}
