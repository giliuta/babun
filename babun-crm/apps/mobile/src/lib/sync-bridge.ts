// STORY-062 slice 5 — mobile sync bridge (freshness on the READ path).
//
// Two independent freshness sources feed ONE react-query invalidate so the
// SWR wrappers re-read after the underlying SQLite cache moves:
//
//   1. REVALIDATE bridge — the wrappers' background revalidate writes fresh
//      server rows into SQLite and, on a real change, fires `revalidated`
//      (shared/sync/revalidate-events). Without this, a warm-cache read served
//      the stale snapshot and the freshened cache was never re-read (slice-4
//      review root cause #2). We subscribe and invalidate the matching key.
//
//   2. REALTIME bridge — postgres_changes on clients / appointments /
//      client_tags, tenant-filtered (shared/sync/realtime). A change made on
//      ANOTHER device invalidates the key so the wrapper re-reads (its
//      revalidate then prunes/patches the cache). Reconnect after a network
//      gap triggers a resync (full re-read) to backfill missed events.
//
// LOOP SAFETY: an invalidate → refetch → wrapper.list → background revalidate
// cycle terminates because the wrapper only emits `revalidated` when the fresh
// server signature DIFFERS from what was cached (revalidate-events loop guard).
// Steady state: refetch, revalidate finds no diff, stays silent.
//
// NATIVE-ONLY: mounted behind Platform.OS !== "web" (see AppProviders). The
// wrappers' SQLite cache is un-injected on the Expo-web target, so there is
// nothing to bridge there; web keeps navigator-driven refetch-on-focus.

import type { QueryClient } from "@tanstack/react-query";
import type { CachedTable } from "@babun/shared/db/cache";
import {
  subscribeRevalidated,
  startRealtimeTenantSync,
} from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";

// Cache-table vocab (clients / appointments / tags) → the react-query key the
// mobile hooks register. Tags live under "client-tags" (features/clients/
// queries.ts useClientTags); the other two match 1:1.
const QUERY_KEY: Record<CachedTable, string> = {
  clients: "clients",
  appointments: "appointments",
  tags: "client-tags",
};

function invalidate(qc: QueryClient, table: CachedTable): void {
  void qc.invalidateQueries({ queryKey: [QUERY_KEY[table]] });
  // Web-parity for the single-client card: `useClient` (["client", id]) is a
  // direct repo read outside the three cached tables, so a clients change on
  // another device (or a background revalidate) would otherwise leave an OPEN
  // card on the snapshot it mounted with until its own focus/refetch. Fan the
  // clients signal out to any active ["client", …] query too — invalidate only
  // marks matching queries stale and refetches the ACTIVE tenant's row via RLS,
  // so there is no cross-tenant read and no cost when no card is open.
  if (table === "clients") {
    void qc.invalidateQueries({ queryKey: ["client"] });
  }
}

type ActiveBridge = {
  tenantId: string | null;
  qc: QueryClient;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
};

let activeBridge: ActiveBridge | null = null;

/** Wire both freshness bridges for the given tenant. Returns an unsubscribe
 *  fn that drops the revalidate listener AND tears down every realtime
 *  channel. Re-called with a new tenant id on tenant change / logout. */
export function startSyncBridge(
  tenantId: string | null,
  qc: QueryClient = queryClient,
): () => void {
  // AppProviders owns one bridge. Defensive replacement also prevents a
  // strict-mode remount from leaving two realtime subscriptions alive.
  activeBridge?.dispose();
  let disposed = false;
  let subscriptions: (() => void) | null = null;

  const mount = () => {
    if (disposed || subscriptions) return;
    // 1. Revalidate bridge — tenant-agnostic (the emit already reflects the
    // active tenant's cache), scoped to this bridge lifetime.
    const unsubRevalidate = subscribeRevalidated((table) =>
      invalidate(qc, table),
    );
    // 2. Realtime bridge — tenant-scoped channels. No-op for null tenant.
    const unsubRealtime = startRealtimeTenantSync({
      supabase,
      tenantId,
      onChange: (table) => invalidate(qc, table),
      onResync: (table) => invalidate(qc, table),
    });
    subscriptions = () => {
      unsubRevalidate();
      unsubRealtime();
    };
  };

  const controller: ActiveBridge = {
    tenantId,
    qc,
    pause: () => {
      subscriptions?.();
      subscriptions = null;
    },
    resume: mount,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      subscriptions?.();
      subscriptions = null;
      if (activeBridge === controller) activeBridge = null;
    },
  };
  activeBridge = controller;
  mount();
  return controller.dispose;
}

/** Temporarily stop old-tenant realtime/revalidate callbacks while local
 * stores and the JWT are being switched. On failure call the returned resume
 * function; on success SessionProvider changes tenantId and the React effect
 * mounts a fresh bridge itself. */
export function pauseSyncBridgeForTenantSwitch(): () => void {
  const previous = activeBridge;
  previous?.pause();
  return () => {
    if (previous && activeBridge === previous) previous.resume();
  };
}
