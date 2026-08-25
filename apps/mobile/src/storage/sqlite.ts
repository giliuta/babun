// STORY-062 slice 1 — expo-sqlite adapter for the offline cache.
//
// A near-zero-cost passthrough over `openDatabaseSync('babun-cache.db')`.
// The shared SqlAdapter contract (packages/shared/src/storage/sql/types.ts)
// was defined as the exact subset of expo-sqlite's SQLiteDatabase surface
// the cache uses, so most methods just delegate.
//
// The DB is opened LAZILY on first use, mirroring the MMKV adapter: an
// open at module-eval could run during an iOS prewarm; deferring it keeps
// module import side-effect-free. `openDatabaseSync` itself is cheap and
// synchronous, but lazy-opening also means a construction in a non-native
// context (should never happen — web never injects this) fails at call
// time, not import time.

import {
  openDatabaseSync,
  type SQLiteDatabase,
} from "expo-sqlite";
import type {
  SqlAdapter,
  SqlBindParams,
  SqlRunResult,
} from "@babun/shared/storage/sql";

const DB_NAME = "babun-cache.db";

export class ExpoSqliteAdapter implements SqlAdapter {
  private db: SQLiteDatabase | null = null;

  private handle(): SQLiteDatabase {
    this.db ??= openDatabaseSync(DB_NAME);
    return this.db;
  }

  execAsync(source: string): Promise<void> {
    return this.handle().execAsync(source);
  }

  runAsync(source: string, params?: SqlBindParams): Promise<SqlRunResult> {
    // expo-sqlite's runAsync requires the params arg (no undefined
    // overload); pass an empty array when the caller omitted it.
    return this.handle().runAsync(source, params ?? []);
  }

  getAllAsync<T>(source: string, params?: SqlBindParams): Promise<T[]> {
    return this.handle().getAllAsync<T>(source, params ?? []);
  }

  getFirstAsync<T>(source: string, params?: SqlBindParams): Promise<T | null> {
    return this.handle().getFirstAsync<T>(source, params ?? []);
  }

  withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return this.handle().withTransactionAsync(task);
  }

  withExclusiveTransactionAsync(
    task: (txn: SqlAdapter) => Promise<void>,
  ): Promise<void> {
    // expo-sqlite hands the callback a `Transaction` object (a subclass of
    // SQLiteDatabase). It structurally implements every SqlAdapter method
    // with matching signatures, so we forward it straight through as the
    // scoped adapter — queries the cache layer runs on `txn` stay INSIDE
    // the exclusive transaction. Other async writers abort with «database
    // is locked» until this commits, which is exactly the isolation the
    // atomic enqueue+upsert pair and cacheClearAll wipe need.
    return this.handle().withExclusiveTransactionAsync(
      (txn) => task(txn as unknown as SqlAdapter),
    );
  }
}
