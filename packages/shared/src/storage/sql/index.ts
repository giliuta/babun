// STORY-062 slice 1 — storage/sql namespace barrel.
//
// Public API for `@babun/shared/storage/sql`. The RN app bootstrap calls
// setSql()/setNetwork(); the cache layer calls getSql()/getNetwork().
// Adapters (Memory / AlwaysOnline) are exported so tests + RN can build
// their own instances.

export type {
  SqlAdapter,
  NetworkAdapter,
  SqlBindParams,
  SqlBindValue,
  SqlRunResult,
} from "./types";

export {
  getSql,
  setSql,
  getNetwork,
  setNetwork,
  NavigatorOnlineNetwork,
} from "./provider";

export {
  NoCacheSqlAdapter,
  OfflineQueueUnavailableError,
} from "./no-cache";

export {
  MemorySqlAdapter,
  AlwaysOnlineNetwork,
  type RawSqliteDb,
  type RawSqliteStatement,
} from "./memory";
