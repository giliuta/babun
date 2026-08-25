// STORY-035 G1 — In-memory implementation of KVStorage.
//
// Used by:
//   * Future tests (vitest) — fresh instance per test, no leakage.
//   * RN dev preview — when the host app wants a clean slate.
//   * Story Books — render previews of components that read from
//     storage without touching the user's real localStorage.
//
// Backed by a plain Map<string, string>.  JSON-stored values still
// round-trip through the same JSON.parse/stringify path as web, so
// behavior matches WebKVStorage byte-for-byte.

import type { KVStorage } from "./types";

export class MemoryKVStorage implements KVStorage {
  private store = new Map<string, string>();

  get<T>(key: string): T | null {
    const raw = this.store.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, JSON.stringify(value));
  }

  getRaw(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setRaw(key: string, value: string): void {
    this.store.set(key, value);
  }

  remove(key: string): void {
    this.store.delete(key);
  }

  list(prefix = ""): string[] {
    if (prefix === "") return Array.from(this.store.keys());
    return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
  }
}
