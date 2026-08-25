// STORY-035 G1 — synchronous KV storage abstraction.
//
// Design contract:
//   * SYNC ONLY.  Babun's UI tree relies on the
//     `useState(() => loadX())` pattern in 30+ provider call-sites;
//     async would force flicker + a major refactor of layout.tsx.
//     Web uses localStorage (sync); future RN uses
//     react-native-mmkv (also sync, ~32 MB quota).
//
//   * JSON-by-default.  Most stores serialize objects/arrays.  `get`
//     and `set` JSON-marshal automatically.
//
//   * Raw escape-hatch.  A handful of legacy keys store plain string
//     markers (e.g. "1" for "closed", "0" for "open") that pre-date
//     this interface.  `getRaw`/`setRaw` preserve those byte-for-byte
//     so we don't change data already written to user devices.
//
// Implementations:
//   * Web      — WebKVStorage (storage/web.ts)
//   * RN       — MMKVStorage (future, in apps/mobile)
//   * Tests    — MemoryKVStorage (storage/memory.ts)

export interface KVStorage {
  /**
   * Read and JSON-deserialize a value.
   * Returns null when the key is missing OR the stored payload is
   * not valid JSON.  Callers narrow `T` themselves.
   */
  get<T>(key: string): T | null;

  /**
   * JSON-serialize a value and write it.
   * Throws on storage quota exhaustion (~5 MB on web localStorage,
   * ~32 MB on MMKV).  Caller is expected to handle quota errors at
   * the surface, not here.
   */
  set<T>(key: string, value: T): void;

  /**
   * Read a raw string value (no JSON parsing).
   * Used for legacy markers like "1"/"0" / ISO date strings stored
   * before this abstraction landed.  Returns null when missing.
   */
  getRaw(key: string): string | null;

  /**
   * Write a raw string value (no JSON serialization).
   * Pair with `getRaw`.  Don't use for objects.
   */
  setRaw(key: string, value: string): void;

  /** Remove a key.  No-op when the key doesn't exist. */
  remove(key: string): void;

  /**
   * List keys with the given prefix.  Returns all keys when prefix
   * is omitted or empty.  Order is implementation-defined.
   */
  list(prefix?: string): string[];
}
