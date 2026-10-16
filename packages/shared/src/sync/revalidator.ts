// BACKGROUND REVALIDATION — ONE RUN PER COMPANY AT A TIME.
//
// A cached list answers from SQLite at once and then asks the server in the
// background. Two parallel snapshots of the same company could land in any
// order, so an older one could overwrite a newer one: a second request waits
// for the run in flight instead of starting its own.
//
// A run whose cache replace was cancelled by a fresh local write is marked
// stale (`markStale`): readers waiting on it got the pre-write snapshot, so
// another run follows immediately after it.
//
// `revalidated` is emitted only on a real change, so the app's
// invalidate → refetch → revalidate cycle settles after one pass.

import type { CachedTable } from "../db/cache/index";
import { emitRevalidated } from "./revalidate-events";

export interface Revalidator<Client> {
  revalidate(client: Client, tenantId: string): Promise<void>;
  markStale(tenantId: string): void;
}

export function createRevalidator<Client>(
  table: CachedTable,
  /** Pulls the server list into the cache; true when the cache changed. */
  refresh: (client: Client, tenantId: string) => Promise<boolean>,
): Revalidator<Client> {
  const running = new Map<string, Promise<void>>();
  const stale = new Set<string>();

  function revalidate(client: Client, tenantId: string): Promise<void> {
    const inFlight = running.get(tenantId);
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        if (await refresh(client, tenantId)) emitRevalidated(table);
      } catch {
        // The cached list has already been returned; the UI keeps it.
      } finally {
        running.delete(tenantId);
        if (stale.delete(tenantId)) void revalidate(client, tenantId);
      }
    })();
    running.set(tenantId, run);
    return run;
  }

  return {
    revalidate,
    markStale: (tenantId) => {
      stale.add(tenantId);
    },
  };
}
