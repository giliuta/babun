// STORY-062 slice 1 — singleton accessors for the active SqlAdapter +
// NetworkAdapter. Modelled on storage/provider.ts (the KVStorage one):
// lazy default with a platform guard, loud throw on native before the
// app entry injects the real backend.
//
//   * SqlAdapter — there is NO safe default. The offline cache is
//     row-oriented SQLite; there is no cross-platform "no-op" backend
//     that wouldn't silently drop writes. The app entry MUST call
//     setSql(new ExpoSqliteAdapter()) in bootstrap.ts BEFORE any cache
//     function runs. If a cache read/write fires first, getSql() THROWS
//     rather than silently losing data (Babun's #1 invariant: a loud
//     crash beats invisible data loss).
//
//     Web never injects a SqlAdapter — the web app keeps its IndexedDB
//     cache (db/cache/index.ts) untouched and never imports the SQL
//     cache (db/cache/sql.ts). getSql() is only ever reached on native.
//
//   * NetworkAdapter — safe default exists. `NavigatorOnlineNetwork`
//     reads `navigator.onLine`, matching the prior web `network.ts`
//     behaviour exactly (SSR-optimistic → true when navigator is
//     undefined). RN overrides it with NetInfo in bootstrap.ts.

import type { NetworkAdapter, SqlAdapter } from "./types";

let _sql: SqlAdapter | null = null;
let _network: NetworkAdapter | null = null;

/** Read the active SQL backend. The cache layer calls this on every
 *  read/write. THROWS if the app entry hasn't injected an adapter — we
 *  never fabricate a silent no-op SQLite. */
export function getSql(): SqlAdapter {
  if (_sql) return _sql;
  throw new Error(
    "[@babun/shared/storage/sql] No SqlAdapter configured. Call " +
      "setSql(new ExpoSqliteAdapter()) in the app entry (bootstrap.ts) " +
      "BEFORE any offline-cache function runs. Refusing to silently drop " +
      "writes.",
  );
}

/** Replace the SQL backend. RN bootstrap / tests call this once before
 *  any cache function fires. */
export function setSql(impl: SqlAdapter): void {
  _sql = impl;
}

/** Read the active network detector. Falls back to a `navigator.onLine`
 *  reader, matching the old web `network.ts` default so web behaviour is
 *  unchanged. RN overrides via `setNetwork(new NetInfoNetwork())`. */
export function getNetwork(): NetworkAdapter {
  if (_network) return _network;
  _network = new NavigatorOnlineNetwork();
  return _network;
}

/** Replace the network detector. RN bootstrap calls this with NetInfo. */
export function setNetwork(impl: NetworkAdapter): void {
  _network = impl;
}

/** Default web / SSR network detector — reads `navigator.onLine` and
 *  wires the window online/offline events, byte-for-byte matching the
 *  old apps/web/src/lib/sync/network.ts. Kept here (not in a web-only
 *  file) so `getNetwork()` has a working default with zero injection. */
export class NavigatorOnlineNetwork implements NetworkAdapter {
  private readonly listeners = new Set<(online: boolean) => void>();
  private attached = false;

  private ensureAttached(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    const broadcast = () => {
      const v = this.isOnline();
      this.listeners.forEach((cb) => {
        try {
          cb(v);
        } catch {
          /* ignore subscriber errors */
        }
      });
    };
    window.addEventListener("online", broadcast);
    window.addEventListener("offline", broadcast);
  }

  isOnline(): boolean {
    if (typeof navigator === "undefined") return true; // SSR optimistic
    return navigator.onLine;
  }

  subscribe(cb: (online: boolean) => void): () => void {
    this.ensureAttached();
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
