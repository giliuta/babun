// STORY-062 slice 5 — cache-revalidated notifier (the "revalidate bridge").
//
// PROBLEM this closes: the SWR list wrappers (clientsCached / appointmentsCached
// / tagsCached) return the cached snapshot synchronously and kick a background
// `refreshCacheFromSupabase` that writes the fresh server rows into SQLite. But
// SQLite has no change events and the mobile app has no realtime bridge on the
// read path, so that background refresh moved the cache WITHOUT the UI ever
// re-reading it. Result: an online list could sit on a stale snapshot until the
// next manual refetch (offline-plan slice-4 review, root cause #2).
//
// FIX: after a background revalidate that ACTUALLY CHANGED the cached data, the
// wrapper calls `emitRevalidated(table)`. The mobile app subscribes
// (`subscribeRevalidated`) and invalidates the matching react-query key so the
// list re-reads — now hitting the freshly-written cache. One module-level
// emitter, same pattern as queue-events.
//
// LOOP GUARD (critical): the wrappers only emit when the fresh server data
// DIFFERS from what was already cached (they diff by a cheap signature — see
// `cacheSignature` below). Without that, every invalidate would refetch →
// re-run the wrapper → re-revalidate → emit → invalidate … forever. With it,
// a steady state (server unchanged) revalidates, finds no diff, and stays
// silent, so the cycle settles after exactly one refetch.
//
// WEB IS UNAFFECTED: apps/web imports neither these wrappers nor this module
// (it has its own IndexedDB sync + useRealtimeTenantSync). This lives only on
// the shared/mobile read path.

import type { CachedTable } from "../db/cache/index";

type Listener = (table: CachedTable) => void;
const listeners = new Set<Listener>();

/** Fired by a list wrapper after a background revalidate wrote CHANGED data
 *  into the cache. `table` lets the subscriber invalidate only the affected
 *  query tree. */
export function emitRevalidated(table: CachedTable): void {
  listeners.forEach((cb) => {
    try {
      cb(table);
    } catch {
      /* ignore subscriber errors — one bad listener must not wedge the rest */
    }
  });
}

/** Subscribe to cache-revalidated events. Returns an unsubscribe fn. The
 *  mobile app wires this to `queryClient.invalidateQueries` per table. */
export function subscribeRevalidated(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Cheap order-independent change signature for a set of cached rows, used by
 *  the wrappers' loop guard. Two snapshots with the same signature are treated
 *  as unchanged → no emit → no refetch loop.
 *
 *  The accepted shapes (CachedClientData / CachedAppointmentData / CachedTag)
 *  are domain objects without an index signature, so the parameter is typed
 *  structurally (`{ id; updated_at? }`) rather than `Record<string, unknown>`.
 *
 *  Keyed on `id` + the row's freshness marker (`updated_at` when present; for
 *  tags, which have no `updated_at`, we fold the whole row so a rename/recolour
 *  still registers). Sorted before joining so row order (which PostgREST does
 *  not guarantee stable) never produces a spurious diff. Row COUNT is implicit
 *  in the id list, so a create/delete always changes the signature.
 *
 *  KEY-ORDER GUARD (tags): for rows without `updated_at` the stamp folds the
 *  whole row, so it must be INDEPENDENT of JSON key order. An optimistic tag
 *  row is built `{id, tenant_id, name, color}` while PostgREST `select("*")`
 *  returns `{color, id, name, tenant_id}` — plain `JSON.stringify` gives two
 *  different strings for identical data, so `before !== after` fired a wasted
 *  emit after every tag write. `stableStamp` sorts keys first, so equal data
 *  yields an equal stamp regardless of column order. */
export function cacheSignature(
  rows: ReadonlyArray<{ id: string; updated_at?: string | null }>,
): string {
  const parts = rows.map((r) => {
    const id = String(r.id ?? "");
    const stamp =
      r.updated_at != null ? String(r.updated_at) : stableStamp(r);
    return `${id}@${stamp}`;
  });
  parts.sort();
  return `${parts.length}:${parts.join("|")}`;
}

/** Deterministic fingerprint of a flat row with keys sorted, so the stamp of a
 *  row without `updated_at` (tags) doesn't depend on the column order PostgREST
 *  happens to return vs. how the optimistic row was constructed. Typed
 *  structurally (the accepted shapes have no index signature). */
function stableStamp(row: { id: string; updated_at?: string | null }): string {
  const bag = row as Record<string, unknown>;
  return Object.keys(bag)
    .sort()
    .map((k) => `${k}=${JSON.stringify(bag[k])}`)
    .join("|");
}
