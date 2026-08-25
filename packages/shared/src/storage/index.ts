// STORY-035 G1 — storage namespace barrel.
//
// Public API for `@babun/shared/storage`.  Stores call `getStorage()`;
// app bootstrap may call `setStorage()`.  Implementations are also
// exported so RN/tests can construct their own instances.

export type { KVStorage } from "./types";
export { WebKVStorage } from "./web";
export { MemoryKVStorage } from "./memory";
export { getStorage, setStorage } from "./provider";
