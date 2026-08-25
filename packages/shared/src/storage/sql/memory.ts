// STORY-062 slice 1 — in-memory SqlAdapter + always-online network for
// bun unit tests.
//
// Rather than hand-rolling a SQL interpreter (fragile, and it would
// diverge from real SQLite semantics the moment the cache DDL grows an
// index or a PRAGMA), MemorySqlAdapter wraps a caller-supplied SQLite
// handle. In the bun test that handle is `new Database(":memory:")`
// from the built-in `bun:sqlite` module — so the test exercises the
// exact SQL the cache layer emits against a real SQLite engine, with no
// disk and no cleanup.
//
// The `bun:sqlite` import lives in the TEST, not here: this file must
// stay importable from the web/RN TypeScript projects (which have no
// `bun:sqlite` types), so the concrete driver is injected through the
// tiny RawSqliteDb interface below.

import type {
  NetworkAdapter,
  SqlAdapter,
  SqlBindParams,
  SqlRunResult,
} from "./types";

/** The slice of a synchronous SQLite driver (bun:sqlite's `Database`,
 *  better-sqlite3, expo-sqlite's *Sync API, …) that MemorySqlAdapter
 *  needs. `bun:sqlite`'s `Database` satisfies this structurally:
 *    - `exec(sql)` for DDL
 *    - `query(sql)` → a statement with `.run(...params)` / `.all(...)` /
 *      `.get(...)`. */
export interface RawSqliteStatement {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
export interface RawSqliteDb {
  exec(sql: string): void;
  query(sql: string): RawSqliteStatement;
}

/** Flatten the adapter's `SqlBindParams` (array | record) into the
 *  positional args a synchronous driver expects. The cache layer only
 *  ever uses the positional-array form, so the record branch is a
 *  belt-and-suspenders fallback. */
function toArgs(params?: SqlBindParams): unknown[] {
  if (params == null) return [];
  return Array.isArray(params) ? params : Object.values(params);
}

/** In-memory SqlAdapter for tests. Backed by an injected synchronous
 *  SQLite handle; every async method resolves immediately. */
export class MemorySqlAdapter implements SqlAdapter {
  constructor(private readonly db: RawSqliteDb) {}

  async execAsync(source: string): Promise<void> {
    this.db.exec(source);
  }

  async runAsync(source: string, params?: SqlBindParams): Promise<SqlRunResult> {
    const r = this.db.query(source).run(...toArgs(params));
    return {
      lastInsertRowId: Number(r.lastInsertRowid),
      changes: Number(r.changes),
    };
  }

  async getAllAsync<T>(source: string, params?: SqlBindParams): Promise<T[]> {
    return this.db.query(source).all(...toArgs(params)) as T[];
  }

  async getFirstAsync<T>(
    source: string,
    params?: SqlBindParams,
  ): Promise<T | null> {
    const row = this.db.query(source).get(...toArgs(params));
    return (row ?? null) as T | null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    // Emulate expo-sqlite's withTransactionAsync with explicit BEGIN /
    // COMMIT / ROLLBACK. `task` is async but the driver is sync — the
    // await points inside `task` still run between the sync exec calls,
    // which is exactly how expo-sqlite behaves. On throw we roll back so
    // the "enqueue + upsert atomic" invariant holds in tests too.
    this.db.exec("BEGIN");
    try {
      await task();
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back / no tx — ignore */
      }
      throw err;
    }
  }

  async withExclusiveTransactionAsync(
    task: (txn: SqlAdapter) => Promise<void>,
  ): Promise<void> {
    // The in-memory driver is a single synchronous handle — there are no
    // concurrent async writers to race against in a bun test — so an
    // exclusive tx behaves like the plain one, plus BEGIN EXCLUSIVE for
    // fidelity to the real engine's locking. `this` IS the scoped adapter
    // (all queries route to the same handle), matching how expo-sqlite's
    // Transaction wraps the same underlying connection.
    this.db.exec("BEGIN EXCLUSIVE");
    try {
      await task(this);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back / no tx — ignore */
      }
      throw err;
    }
  }
}

/** Network adapter for tests — always online, no events. Mirrors the
 *  SSR-optimistic default of the web network detector. */
export class AlwaysOnlineNetwork implements NetworkAdapter {
  isOnline(): boolean {
    return true;
  }
  subscribe(_cb: (online: boolean) => void): () => void {
    return () => {};
  }
}
