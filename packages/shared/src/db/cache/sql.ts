// STORY-062 slice 1 — SQLite offline cache. Byte-for-byte-compatible
// public surface with the web IndexedDB cache (db/cache/index.ts), so
// the sync layer (replayer / cached-wrappers / queue-events) can run
// unchanged on top of either backend once it is shared.
//
// WHY A PARALLEL FILE (not a rewrite of index.ts):
//   The web app runs db/cache/index.ts (IndexedDB) in PRODUCTION —
//   DashboardClientLayout, SyncQueuePanel and the whole apps/web sync
//   layer import it. Rewriting index.ts onto a SqlAdapter would force
//   the web app to inject a SqlAdapter it doesn't have and can't (no
//   expo-sqlite in a browser). So index.ts stays IndexedDB, untouched,
//   and THIS file is the SQLite twin the mobile app injects via the
//   storage/sql provider. Types are re-exported from index.ts so both
//   backends share one QueuedOp / CachedTable / Cached* definition.
//
// Backend is resolved lazily through getSql() on every call — the same
// singleton the app entry seeds with setSql(new ExpoSqliteAdapter()).
// getSql() THROWS before injection, so a cache call that races the
// bootstrap crashes loudly instead of dropping the write silently.
//
// Row storage: the full row is JSON-stringified into `data`; the
// filter/sort columns (tenant_id / updated_at / date) are also written
// as their own columns so the indexed reads work. Reads reconstruct the
// row by JSON-parsing `data` — the denormalised columns are never read
// back into the row, avoiding drift.

// The implementation lives in ./sql/ by concern: connection (schema bootstrap,
// local-write counter), rows (generic CRUD), tenant (authoritative replace,
// clears, meta) and queue (outgoing writes).

// Re-export the shared types so callers can import everything cache-
// related from one module regardless of backend.
export type {
  CachedAppointment,
  CachedClient,
  CachedTable,
  CachedTag,
  QueuedOp,
} from "./index";
export type { CachedAppointmentData, CachedClientData } from "./sql/types";

export {
  __resetCacheForTests,
  cacheLocalWriteSeq,
  getCache,
} from "./sql/connection";
export {
  cacheBulkUpsert,
  cacheDelete,
  cacheGetOne,
  cacheRead,
  cacheUpsert,
} from "./sql/rows";
export {
  cacheClearAll,
  cacheClearTenant,
  cacheReplaceTenant,
  hasAuthoritativeTenantSnapshot,
  readMeta,
  writeMeta,
} from "./sql/tenant";
export {
  bumpAttempt,
  dequeueAll,
  enqueueOp,
  enqueueOpWithCacheDelete,
  enqueueOpWithCacheUpsert,
  forwardQueuedSentinel,
  hasQueuedOps,
  hasStuckQueuedOps,
  markOpPermanentlyFailed,
  queueDepth,
  removeOp,
  resetOpAttempts,
} from "./sql/queue";
export {
  clearMemberOpsOfTenant,
  enqueueMemberOp,
  hasMemberOps,
  listMemberOps,
  markMemberOpRefused,
  memberQueueDepth,
  noteMemberOpAttempt,
  removeMemberOp,
  replaceMemberOpArgs,
  retryMemberOp,
  type MemberQueuedOp,
} from "./sql/member-queue";
