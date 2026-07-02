// STORY-062 slice 2 — NetInfo-backed NetworkAdapter for the offline sync
// layer.
//
// Replaces the web's `navigator.onLine`. Semantics match query-client.ts's
// onlineManager wiring exactly: `isConnected: null` (unknown) is treated as
// ONLINE — we never false-pause on an indeterminate signal, matching
// "setOnline(state.isConnected !== false)".
//
// isOnline() is synchronous per the NetworkAdapter contract, but NetInfo's
// fetch is async. We keep a cached last-known value, seeded true
// (optimistic, like the web SSR default) and kept fresh by a module-level
// subscription so every isOnline() read is O(1) and current.

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { NetworkAdapter } from "@babun/shared/storage/sql";

function stateToOnline(state: NetInfoState): boolean {
  // `isConnected: null` = unknown → treat as online (never false-pause).
  return state.isConnected !== false;
}

export class NetInfoNetwork implements NetworkAdapter {
  // Optimistic seed — matches the web SSR default (true until proven
  // offline). Refreshed by the subscription below.
  private online = true;
  private readonly listeners = new Set<(online: boolean) => void>();
  private unsubscribeNetInfo: (() => void) | null = null;

  constructor() {
    // One module-level NetInfo subscription feeds both the cached
    // isOnline() value and every subscribe() consumer.
    this.unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const next = stateToOnline(state);
      if (next === this.online) return;
      this.online = next;
      this.listeners.forEach((cb) => {
        try {
          cb(next);
        } catch {
          /* ignore subscriber errors */
        }
      });
    });
  }

  isOnline(): boolean {
    return this.online;
  }

  subscribe(cb: (online: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Tear down the underlying NetInfo listener. Not used in the app (the
   *  adapter lives for the process lifetime) but keeps the class leak-free
   *  for tests / hot-reload. */
  dispose(): void {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.listeners.clear();
  }
}
