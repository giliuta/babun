// STORY-062 slice 1 — SQLite schema for the offline cache.
//
// 1:1 port of the IndexedDB object stores in db/cache/index.ts (the web
// cache). Each IDB store becomes a table; the JSON row is stored whole in
// a `data TEXT` column, and the columns the UI filters/sorts on
// (tenant_id / updated_at / date) are denormalised into real columns so
// they can be indexed — the SQLite analogue of an IDB index.
//
//   clients      ← IDB "clients"      (keyPath id; idx tenant, tenant+updated)
//   appointments ← IDB "appointments" (keyPath id; idx tenant, tenant+date, tenant+updated)
//   tags         ← IDB "tags"         (keyPath id; idx tenant)
//   sync_queue   ← IDB "sync_queue"   (autoInc id; idx created_at)
//   sync_meta    ← IDB "sync_meta"    (keyPath key)
//
// Schema versioning uses SQLite's `PRAGMA user_version`, the direct
// analogue of IDB's `DB_VERSION` + upgrade callback. `migrate()` below is
// the single trigger for evolving the schema: bump SCHEMA_VERSION and add
// an `if (from < N)` block. `CREATE TABLE IF NOT EXISTS` keeps first-run
// idempotent.

import type { SqlAdapter } from "../../storage/sql/types";

/** Analogue of the web cache's `DB_VERSION`. Bump + add a migration
 *  branch when the schema changes. */
export const SCHEMA_VERSION = 1;

/** DDL for the whole cache. Kept as one string so first-run is a single
 *  `execAsync` (expo-sqlite runs multiple `;`-separated statements). */
export const CACHE_DDL = `
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY NOT NULL,
  tenant_id  TEXT,
  updated_at TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant          ON clients (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_updated  ON clients (tenant_id, updated_at);

CREATE TABLE IF NOT EXISTS appointments (
  id         TEXT PRIMARY KEY NOT NULL,
  tenant_id  TEXT,
  date       TEXT,
  updated_at TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant          ON appointments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date     ON appointments (tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_updated  ON appointments (tenant_id, updated_at);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY NOT NULL,
  tenant_id  TEXT,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags (tenant_id);

CREATE TABLE IF NOT EXISTS sync_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          INTEGER NOT NULL,
  table_name          TEXT NOT NULL,
  op                  TEXT NOT NULL,
  row_id              TEXT NOT NULL,
  payload             TEXT NOT NULL,
  expected_updated_at TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue (created_at);

CREATE TABLE IF NOT EXISTS sync_meta (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** The five cache tables, in the order `cacheClearAll` wipes them.
 *  Exported so the cache module and any future maintenance code share
 *  one list. */
export const CACHE_TABLES = [
  "clients",
  "appointments",
  "tags",
  "sync_queue",
  "sync_meta",
] as const;

/** Idempotent schema install + migration. Safe to call on every app
 *  start. Runs the DDL (all `CREATE ... IF NOT EXISTS`) then advances
 *  `user_version`. Mirrors the IDB `upgrade(db, oldVersion)` callback. */
export async function migrate(sql: SqlAdapter): Promise<void> {
  const row = await sql.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const from = row?.user_version ?? 0;

  // First-run + future migrations both flow through the DDL, which is
  // fully `IF NOT EXISTS`, so re-running it is a no-op on an up-to-date
  // db. Later versions add `if (from < N) { ...ALTER... }` blocks here.
  await sql.execAsync(CACHE_DDL);

  if (from !== SCHEMA_VERSION) {
    // PRAGMA can't be parameterised; SCHEMA_VERSION is a trusted int
    // literal so string interpolation is safe here.
    await sql.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}
