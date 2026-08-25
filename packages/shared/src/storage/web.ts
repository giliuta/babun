// STORY-035 G1 — Web implementation of KVStorage.
//
// Backed by window.localStorage.  All methods are SSR-safe — they
// no-op when window is undefined so the package can be imported
// from server components and edge runtime without crashing.

import type { KVStorage } from "./types";

export class WebKVStorage implements KVStorage {
  get<T>(key: string): T | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  getRaw(key: string): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  }

  setRaw(key: string, value: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  }

  remove(key: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  }

  list(prefix = ""): string[] {
    if (typeof window === "undefined") return [];
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k != null && (prefix === "" || k.startsWith(prefix))) {
        out.push(k);
      }
    }
    return out;
  }
}
