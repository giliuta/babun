// STORY-062 slice 5 — RN realtime tenant sync (the "realtime bridge").
//
// Lightweight, framework-free port of apps/web/src/hooks/useRealtimeTenantSync.
// The web version is a React hook that hands INSERT/UPDATE/DELETE rows to the
// caller's local state. Mobile's read path is different: the three lists are
// react-query caches backed by the SQLite SWR wrappers, so we don't splice
// individual rows here — on ANY change event we just fire one `onChange(table)`
// callback and let the mobile bridge invalidate the matching query key (which
// re-runs the wrapper → revalidates the cache → re-reads). Coarser than the
// web's row-level dedupe, but correct and simple: react-query coalesces the
// refetch and the wrapper's signature diff stops any refetch→revalidate loop.
//
// One channel per (tenant, table), filtered server-side by
// `tenant_id=eq.<id>`. Supabase Realtime v2 applies the table's RLS SELECT
// policy to every broadcast, so cross-tenant leakage is impossible even if the
// filter were forged.
//
// RECONNECT: a CLOSED / CHANNEL_ERROR transition sets a disconnected flag; the
// next SUBSCRIBED fires `onResync(table)` so the caller backfills anything
// missed during the gap (same semantics as the web hook). Steady-state
// SUBSCRIBED events do not resync.
//
// LIFECYCLE: `startRealtimeTenantSync` returns an unsubscribe fn that removes
// every channel. The mobile bridge calls it on tenant change / logout and
// re-subscribes for the new tenant, so channels never outlive their tenant.
//
// NATIVE-ONLY IN PRACTICE: only the mobile app mounts this; web keeps its own
// hook. It touches no RN/DOM globals, so it also type-checks and runs on the
// Expo-web target without lighting up (the bridge is gated Platform.OS !== web).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/database.types";
import type { CachedTable } from "../db/cache/index";

type DbSupabase = SupabaseClient<Database>;

/** Public-schema table names to subscribe to, paired with the cache table the
 *  change maps onto. `client_tags` (DB) → `tags` (cache vocab). */
const TABLE_MAP: ReadonlyArray<{ dbTable: string; cacheTable: CachedTable }> = [
  { dbTable: "clients", cacheTable: "clients" },
  { dbTable: "appointments", cacheTable: "appointments" },
  { dbTable: "client_tags", cacheTable: "tags" },
];

export interface RealtimeTenantSyncOptions {
  supabase: DbSupabase;
  /** Active tenant. Null → the function no-ops and returns a no-op unsub
   *  (logged-out / pre-onboarding). */
  tenantId: string | null;
  /** Fired on any INSERT/UPDATE/DELETE for a subscribed table. The bridge
   *  invalidates the matching query key + refreshes the SQLite cache. */
  onChange: (table: CachedTable) => void;
  /** Fired after a reconnect (channel dropped then re-subscribed). The bridge
   *  does a full re-read to backfill events missed during the gap. Optional —
   *  defaults to `onChange` (a plain invalidate is a safe superset). */
  onResync?: (table: CachedTable) => void;
}

/** Subscribe all three tenant-scoped tables. Returns an unsubscribe fn that
 *  removes every channel. Idempotent per call — each call opens its own
 *  channel set; the caller (SyncBridgeMount) owns exactly one live set and
 *  tears it down before re-subscribing on a tenant change. */
export function startRealtimeTenantSync(
  options: RealtimeTenantSyncOptions,
): () => void {
  const { supabase, tenantId, onChange } = options;
  const onResync = options.onResync ?? onChange;

  if (!tenantId) return () => {};

  const channels = TABLE_MAP.map(({ dbTable, cacheTable }) => {
    // Per-instance suffix so re-subscribing for the same tenant+table (e.g.
    // network flap) never collides with a not-yet-torn-down channel of the
    // same name (supabase-js v2 errors on a duplicate .subscribe()).
    const suffix = Math.random().toString(36).slice(2, 8);
    const channelName = `tenant:${tenantId}:${dbTable}:${suffix}`;

    let wasDisconnected = false;

    const channel = supabase
      .channel(channelName)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js overload for postgres_changes is untyped for the generic table string
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: dbTable,
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          // We don't inspect the payload: any change → re-read the table.
          onChange(cacheTable);
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          if (wasDisconnected) {
            onResync(cacheTable);
            wasDisconnected = false;
          }
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          wasDisconnected = true;
        }
        // TIMED_OUT is transient — the SDK auto-retries and a later
        // SUBSCRIBED runs the resync branch.
      });

    return channel;
  });

  return () => {
    for (const channel of channels) {
      void supabase.removeChannel(channel);
    }
  };
}
