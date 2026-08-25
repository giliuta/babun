// STORY-062 slice 1 — async SQL storage abstraction for the offline cache.
//
// Design contract (mirrors the KVStorage split in ../types.ts, but for
// the row-oriented offline cache rather than the KV blob store):
//
//   * ASYNC.  Unlike KVStorage (sync, backed by MMKV/localStorage), the
//     offline cache is backed by SQLite (expo-sqlite on RN, an in-memory
//     shim in tests). Every method returns a Promise — the web cache it
//     replaces (IndexedDB) was already async, so callers up the stack
//     (replayer, cached-wrappers) are async end-to-end.
//
//   * SURFACE = the exact subset of expo-sqlite's `SQLiteDatabase` the
//     cache layer needs. Keeping this a strict subset means the RN
//     adapter (storage/sqlite.ts in apps/mobile) is a near-zero-cost
//     passthrough — `openDatabaseSync(...)` returns an object that
//     already implements these five methods with these signatures.
//
//   * NetworkAdapter mirrors the old web `network.ts` (navigator.onLine
//     + subscribe) so the shared sync layer can ask "are we online?"
//     without importing a platform API directly. RN backs it with
//     NetInfo (apps/mobile/src/storage/netinfo.ts); tests use the
//     AlwaysOnlineNetwork below.
//
// Implementations:
//   * RN       — ExpoSqliteAdapter (apps/mobile/src/storage/sqlite.ts)
//   * Tests    — MemorySqlAdapter (./memory.ts)
//   * Web      — NoCacheSqlAdapter (./no-cache), поставляется САМИМ
//                провайдером по умолчанию (см. ./provider). Веба с
//                собственным IndexedDB-кэшем больше нет: операторский
//                Next.js снесён 2026-08-25, и браузер теперь открывает то же
//                самое приложение. Адаптер он не внедряет, но getSql() зовёт
//                — общие cached-wrappers работают на всех платформах, — и в
//                браузере получает «сервер единственное хранилище»: чтение
//                всегда промахивается, зеркальная запись отбрасывается, а
//                офлайн-очередь отказывает ГРОМКО.

/** A bound parameter value accepted by the underlying SQLite driver.
 *  Matches expo-sqlite's `SQLiteBindValue`. `Uint8Array` covers BLOBs —
 *  the cache never writes blobs, but keeping it in the union means the
 *  RN `SQLiteDatabase` structurally satisfies `SqlAdapter` with no cast. */
export type SqlBindValue = string | number | null | boolean | Uint8Array;

/** Positional (`?`) or named (`$foo`) bind params. Matches expo-sqlite's
 *  `SQLiteBindParams`. The cache layer only ever uses the positional
 *  array form. */
export type SqlBindParams = Record<string, SqlBindValue> | SqlBindValue[];

/** Result of a write statement. Matches expo-sqlite's `SQLiteRunResult`
 *  field-for-field so `runAsync` on the RN db satisfies this contract. */
export interface SqlRunResult {
  /** `sqlite3_last_insert_rowid()` — the autoincrement id of the row
   *  just INSERTed. Used by `enqueueOp` to return the new queue id. */
  lastInsertRowId: number;
  /** `sqlite3_changes()` — rows affected. Used by the LWW UPDATE path
   *  to detect "0 rows matched → force-write" without a filter. */
  changes: number;
}

/** The subset of expo-sqlite's `SQLiteDatabase` the offline cache needs.
 *
 *  Method signatures are intentionally byte-identical to expo-sqlite so
 *  the RN adapter is a passthrough. Overloads on the real driver accept
 *  variadic params too; we only declare the array/record form because
 *  that is all the cache uses. */
export interface SqlAdapter {
  /** Run one or more statements with no bound params (DDL, PRAGMA). */
  execAsync(source: string): Promise<void>;

  /** Run a single write (INSERT/UPDATE/DELETE) and return row-count +
   *  last insert id. */
  runAsync(source: string, params?: SqlBindParams): Promise<SqlRunResult>;

  /** Read every matching row, typed as `T`. */
  getAllAsync<T>(source: string, params?: SqlBindParams): Promise<T[]>;

  /** Read the first matching row, or `null` when none match. */
  getFirstAsync<T>(source: string, params?: SqlBindParams): Promise<T | null>;

  /** Run `task` inside a single transaction. The whole callback commits
   *  atomically or rolls back on throw. NON-exclusive: expo-sqlite's
   *  `withTransactionAsync` warns that other async queries can interleave
   *  inside the BEGIN…COMMIT window. Fine for read-mostly or self-contained
   *  bulk writes; NOT safe where isolation from concurrent writers matters
   *  (an interleaved optimistic write could get committed/rolled-back with
   *  someone else's transaction). Use `withExclusiveTransactionAsync` for
   *  those (offline-plan risk #6 atomic pair, cacheClearAll wipe). */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;

  /** Run `task` inside an EXCLUSIVE transaction, isolated from concurrent
   *  async writers (expo-sqlite converts to a write transaction; other
   *  async writes abort with «database is locked» until it commits). The
   *  callback receives a transaction-scoped `SqlAdapter` (`txn`) — every
   *  query inside MUST go through `txn`, not the outer adapter, or it
   *  escapes the transaction (this mirrors expo-sqlite's `Transaction`
   *  object). This is what actually guarantees the "enqueueOp + optimistic
   *  cacheUpsert in ONE transaction" invariant AND that a stray concurrent
   *  cacheUpsert/cacheDelete can't ride inside the wipe/atomic pair
   *  (offline-plan risk #6 + cross-tenant wipe). В браузере транзакции нет
   *  и быть не может: там стоит NoCacheSqlAdapter, у которого нет своего
   *  хранилища — он выполняет `task` (чтобы вызывающий не завис на await),
   *  но откатывать ему нечего, а любая попытка поставить операцию в
   *  офлайн-очередь внутри падает громко. Настоящая изоляция — только на
   *  нативе. */
  withExclusiveTransactionAsync(
    task: (txn: SqlAdapter) => Promise<void>,
  ): Promise<void>;
}

/** Mirror of the old web `network.ts` surface. `isOnline()` replaces the
 *  direct `navigator.onLine` read; `subscribe()` replaces the
 *  window online/offline listeners. RN backs this with NetInfo. */
export interface NetworkAdapter {
  /** Synchronous best-effort "are we online right now?". */
  isOnline(): boolean;
  /** Subscribe to connectivity changes. Returns an unsubscribe fn. */
  subscribe(cb: (online: boolean) => void): () => void;
}
