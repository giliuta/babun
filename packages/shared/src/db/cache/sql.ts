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

import { getSql } from "../../storage/sql/provider";
import type { SqlAdapter } from "../../storage/sql/types";
import { migrate } from "./schema";
import type { Client } from "../../local/clients";
import type { Appointment } from "../../local/appointments";
import type {
  CachedAppointment,
  CachedClient,
  CachedTable,
  CachedTag,
  QueuedOp,
} from "./index";

// Re-export the shared types so callers can import everything cache-
// related from one module regardless of backend.
export type {
  CachedAppointment,
  CachedClient,
  CachedTable,
  CachedTag,
  QueuedOp,
} from "./index";

// ─── Cache-of-DOMAIN row shapes (slice 5) ─────────────────────────────
// The `data` column is opaque JSON — the SQL layer only ever reads the
// denormalised keys (`id`, `tenant_id`, `updated_at`, `date`) off the
// top level to fill the indexed columns; the rest round-trips untouched.
//
// Slice 5 fix: the cached-wrappers now store the FULL DOMAIN object (the
// same shape `repositories/*.list*` return — `Client` WITH `tag_ids`,
// `Appointment` with nested arrays) instead of the raw DB Row. That keeps
// online reads-from-cache byte-identical to a live repo read (no `tag_ids`
// regression, no emptied nested fields). To satisfy the SQL layer's
// denorm-key extraction + the tenant-scoped reads, the stored object is the
// domain object DECORATED with the two bookkeeping keys the domain shape
// itself doesn't carry (`tenant_id`; `updated_at` for clients — Appointment
// already has `updated_at` + `date`).
//
// The queue PAYLOAD is a DIFFERENT projection (raw DB columns the server
// accepts) and is built separately in the wrappers — see the "two
// projections" note there. These types describe only what lands in `data`.
export type CachedClientData = Client & {
  tenant_id: string;
  updated_at: string;
};
export type CachedAppointmentData = Appointment & {
  tenant_id: string;
};

// Anything the cache can store in `data`. The write/read APIs accept the
// domain-decorated shapes (slice 5) as well as the raw Row shapes still
// used by a few tests + the replayer's canonical-row write-through. All
// that matters at this layer is the presence of the denorm keys, which
// every member carries.
type CachedRow =
  | CachedClient
  | CachedAppointment
  | CachedTag
  | CachedClientData
  | CachedAppointmentData;

// ─── Schema bootstrap (run-once, awaited by every call) ───────────────
// Mirrors the web cache's `getCache()` singleton: the first call opens +
// migrates; every later call reuses the resolved promise. We memoise the
// *migration*, not a db handle — the handle is the injected SqlAdapter.

let migratePromise: Promise<void> | null = null;

/** Ensure the schema exists, exactly once per process. Returns the live
 *  SqlAdapter so callers can `const sql = await ready()` in one line. */
async function ready(): Promise<SqlAdapter> {
  const sql = getSql();
  if (!migratePromise) {
    migratePromise = migrate(sql).catch((err) => {
      // Reset so a transient failure (locked db during prewarm) retries
      // on the next call instead of wedging the cache forever.
      migratePromise = null;
      throw err;
    });
  }
  await migratePromise;
  return sql;
}

/** Test seam — drop the memoised migration so a fresh in-memory adapter
 *  re-migrates. Never called in production. */
export function __resetCacheForTests(): void {
  migratePromise = null;
}

// ─── Table-name guard ────────────────────────────────────────────────
// `CachedTable` is a compile-time union; we still validate at runtime
// before interpolating it into SQL (table names can't be bound params).
// Every value here is a trusted literal — no user input reaches this.
const TABLE_NAMES: Record<CachedTable, string> = {
  clients: "clients",
  appointments: "appointments",
  tags: "tags",
};

function tableName(table: CachedTable): string {
  const name = TABLE_NAMES[table];
  if (!name) throw new Error(`[cache] unknown table: ${String(table)}`);
  return name;
}

const AUTHORITATIVE_SNAPSHOT_PREFIX = "authoritative-snapshot";

function authoritativeSnapshotKey(
  table: CachedTable,
  tenantId: string,
): string {
  return `${AUTHORITATIVE_SNAPSHOT_PREFIX}:${table}:${tenantId}`;
}

// ─── Row (de)serialisation ───────────────────────────────────────────

function serializeRow(row: CachedRow): string {
  return JSON.stringify(row);
}

function parseRow<T extends CachedRow>(data: string): T {
  return JSON.parse(data) as T;
}

// ─── getCache() shim ─────────────────────────────────────────────────
// The web cache exposes `getCache()` returning an IDBPDatabase, and a few
// call-sites do `(await getCache()).get(table, id)` for single-row reads.
// SQLite has no such handle. We expose `cacheGetOne(table, id)` as the
// first-class single-row read; `getCache()` returns the raw SqlAdapter for
// any advanced/escape-hatch use, keeping the export name present.
export async function getCache(): Promise<SqlAdapter> {
  return ready();
}

// ─── Read API ─────────────────────────────────────────────────────────

export async function cacheRead<T extends CachedRow>(
  table: CachedTable,
  tenantId: string,
): Promise<T[]> {
  const sql = await ready();
  const rows = await sql.getAllAsync<{ data: string }>(
    `SELECT data FROM ${tableName(table)} WHERE tenant_id = ?`,
    [tenantId],
  );
  return rows.map((r) => parseRow<T>(r.data));
}

/** Single-row read by primary key. Replaces the web pattern
 *  `(await getCache()).get(table, id)` used by the cached-wrappers'
 *  `refetchAndCacheOne` / `readCachedX` helpers. Returns null when
 *  absent.
 *
 *  `tenantId` is optional and additive: when supplied the read is scoped
 *  `WHERE id = ? AND tenant_id = ?`, matching the tenant-scope invariant
 *  cacheRead already enforces. It guards the multi-tenant-user case (one
 *  shared babun-cache.db holding rows for several of the user's tenants):
 *  without it a snapshot for LWW / optimistic merge could be taken from a
 *  row belonging to a non-active tenant if ids ever collided. Callers that
 *  omit it keep the exact prior behaviour (bare `WHERE id = ?`). */
export async function cacheGetOne<T extends CachedRow>(
  table: CachedTable,
  id: string,
  tenantId?: string,
): Promise<T | null> {
  const sql = await ready();
  const row =
    tenantId === undefined
      ? await sql.getFirstAsync<{ data: string }>(
          `SELECT data FROM ${tableName(table)} WHERE id = ?`,
          [id],
        )
      : await sql.getFirstAsync<{ data: string }>(
          `SELECT data FROM ${tableName(table)} WHERE id = ? AND tenant_id = ?`,
          [id, tenantId],
        );
  return row ? parseRow<T>(row.data) : null;
}

// ─── Write-through API (single row) ───────────────────────────────────

export async function cacheUpsert<T extends CachedRow>(
  table: CachedTable,
  row: T,
): Promise<void> {
  const sql = await ready();
  await upsertRow(sql, table, row);
}

/** Internal upsert usable inside an existing transaction (see
 *  enqueueOpWithCacheUpsert). Splits by table because the denormalised
 *  columns differ (appointments has `date`, tags has no `updated_at`). */
async function upsertRow(
  sql: SqlAdapter,
  table: CachedTable,
  row: CachedRow,
): Promise<void> {
  const data = serializeRow(row);
  const r = row as Record<string, unknown>;
  const id = r.id as string;
  const tenantId = (r.tenant_id ?? null) as string | null;

  if (table === "appointments") {
    await sql.runAsync(
      `INSERT INTO appointments (id, tenant_id, date, updated_at, data)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         date = excluded.date,
         updated_at = excluded.updated_at,
         data = excluded.data`,
      [
        id,
        tenantId,
        (r.date ?? null) as string | null,
        (r.updated_at ?? null) as string | null,
        data,
      ],
    );
    return;
  }

  if (table === "tags") {
    await sql.runAsync(
      `INSERT INTO tags (id, tenant_id, data)
         VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         data = excluded.data`,
      [id, tenantId, data],
    );
    return;
  }

  // clients
  await sql.runAsync(
    `INSERT INTO clients (id, tenant_id, updated_at, data)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       updated_at = excluded.updated_at,
       data = excluded.data`,
    [id, tenantId, (r.updated_at ?? null) as string | null, data],
  );
}

export async function cacheDelete(
  table: CachedTable,
  id: string,
): Promise<void> {
  const sql = await ready();
  await deleteRow(sql, table, id);
}

/** Internal delete usable inside an existing transaction (see
 *  enqueueOpWithCacheDelete). */
async function deleteRow(
  sql: SqlAdapter,
  table: CachedTable,
  id: string,
): Promise<void> {
  await sql.runAsync(`DELETE FROM ${tableName(table)} WHERE id = ?`, [id]);
}

// ─── Bulk API (bootstrap + reconnect resync) ──────────────────────────

export async function cacheBulkUpsert<T extends CachedRow>(
  table: CachedTable,
  rows: T[],
): Promise<void> {
  if (rows.length === 0) return;
  const sql = await ready();
  // Exclusive: a bulk resync (reconnect / cold-cache fill) writes many
  // rows; an interleaved optimistic single-row write must not land inside
  // this BEGIN…COMMIT and get committed/rolled-back with the whole batch.
  await sql.withExclusiveTransactionAsync(async (txn) => {
    for (const row of rows) {
      await upsertRow(txn, table, row);
    }
  });
}

/** AUTHORITATIVE tenant resync (slice 5). Replace every cached row for a
 *  tenant with the supplied server snapshot in ONE EXCLUSIVE transaction:
 *  DELETE the tenant's rows, then re-insert `rows`. Unlike `cacheBulkUpsert`
 *  (upsert-only) this PRUNES rows the server no longer has — a client/appt/
 *  tag deleted on another device would otherwise linger in the cache forever
 *  and the online list would show a phantom row (offline-plan: «лучше пусто,
 *  чем неверно»). The single exclusive tx makes it crash-safe and stops an
 *  interleaved optimistic write from landing between the clear and the fill.
 *
 *  `rows.length === 0` still runs the DELETE — an emptied server table must
 *  empty the cache too (that's the whole point vs. bulk-upsert's early-out). */
export async function cacheReplaceTenant<T extends CachedRow>(
  table: CachedTable,
  tenantId: string,
  rows: T[],
): Promise<void> {
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `DELETE FROM ${tableName(table)} WHERE tenant_id = ?`,
      [tenantId],
    );
    for (const row of rows) {
      await upsertRow(txn, table, row);
    }
    // Rows alone cannot distinguish «the server authoritatively returned an
    // empty list» from «this device has never synced the table». Keep the
    // marker in the SAME transaction as the replacement so cold-offline
    // readers can safely show a known-empty calendar without treating an
    // unknown cache miss as free availability.
    await txn.runAsync(
      `INSERT INTO sync_meta (key, value, updated_at)
         VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [authoritativeSnapshotKey(table, tenantId), "1", Date.now()],
    );
  });
}

/** True after at least one authoritative server snapshot, including []. */
export async function hasAuthoritativeTenantSnapshot(
  table: CachedTable,
  tenantId: string,
): Promise<boolean> {
  return (await readMeta(authoritativeSnapshotKey(table, tenantId))) === "1";
}

/** Drop every row in `table` for a given tenant. Analogue of the web
 *  cursor-delete; a single indexed DELETE here. We never truncate the
 *  whole table because another tenant the user belongs to may still be
 *  using it. */
export async function cacheClearTenant(
  table: CachedTable,
  tenantId: string,
): Promise<void> {
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `DELETE FROM ${tableName(table)} WHERE tenant_id = ?`,
      [tenantId],
    );
    await txn.runAsync("DELETE FROM sync_meta WHERE key = ?", [
      authoritativeSnapshotKey(table, tenantId),
    ]);
  });
}

/** Wipe every table. Called on auth.signOut (cross-tenant leak guard —
 *  offline-plan risk #1). All five deletes run in ONE EXCLUSIVE transaction
 *  so a concurrent optimistic write racing the wipe can't (a) land inside
 *  the BEGIN…COMMIT and get rolled back with it, or (b) survive as a
 *  half-wiped orphan — the write blocks («database is locked») until the
 *  wipe commits, then either fails or runs cleanly against the empty db. */
export async function cacheClearAll(): Promise<void> {
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(
      `DELETE FROM clients;
       DELETE FROM appointments;
       DELETE FROM tags;
       DELETE FROM sync_queue;
       DELETE FROM sync_meta;`,
    );
  });
}

// ─── Queue API ────────────────────────────────────────────────────────

/** Map a `QueuedOp.table` (cache vocab) to its DB column value. Stored
 *  in `sync_queue.table_name` (the column is named table_name because
 *  `table` is a SQL keyword). */
function queueRowToOp(row: {
  id: number;
  created_at: number;
  table_name: string;
  op: string;
  row_id: string;
  payload: string;
  expected_updated_at: string | null;
  attempts: number;
  last_error: string | null;
}): QueuedOp {
  const op: QueuedOp = {
    id: row.id,
    created_at: row.created_at,
    table: row.table_name as CachedTable,
    op: row.op as QueuedOp["op"],
    row_id: row.row_id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    expected_updated_at: row.expected_updated_at,
    attempts: row.attempts,
  };
  // Only attach last_error when present — the web `QueuedOp` leaves it
  // absent (not `undefined`) so equality/serialisation matches.
  if (row.last_error != null) op.last_error = row.last_error;
  return op;
}

/** Insert a queued op with no id (AUTOINCREMENT assigns it) and no
 *  created_at/attempts (defaulted here, matching the web cache). */
export async function enqueueOp(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  const sql = await ready();
  await insertOp(sql, op);
}

async function insertOp(
  sql: SqlAdapter,
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  await sql.runAsync(
    `INSERT INTO sync_queue
       (created_at, table_name, op, row_id, payload, expected_updated_at, attempts, last_error)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    [
      Date.now(),
      op.table,
      op.op,
      op.row_id,
      JSON.stringify(op.payload),
      op.expected_updated_at,
    ],
  );
}

/** ATOMIC enqueue + optimistic cache upsert (offline-plan risk #6). The
 *  web cache leaves these as two separate calls; on SQLite we can — and
 *  must — run them in one EXCLUSIVE transaction so (a) a crash between them
 *  can't leave an optimistic row with no queued op (or vice-versa), and
 *  (b) a concurrent write can't interleave into the pair. Not part of the
 *  web IndexedDB surface; the shared cached-wrappers (slice 3/4) call THIS
 *  on the offline path instead of `enqueueOp` + `cacheUpsert`.
 *
 *  NOTE — this bypasses queue-events' emitQueueChange (it lives one layer
 *  up). Callers that need the queue badge to update immediately go through
 *  `enqueueOpWithCacheUpsertAndEmit` in ./queue-events (which emits after
 *  this resolves); the 5 s safety poll is the fallback either way. */
export async function enqueueOpWithCacheUpsert<T extends CachedRow>(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  row: T,
): Promise<void> {
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await upsertRow(txn, table, row);
    await insertOp(txn, op);
  });
}

/** ATOMIC enqueue + optimistic cache DELETE (offline-plan risk #6, delete
 *  side). Same rationale as enqueueOpWithCacheUpsert: the optimistic
 *  cacheDelete and the queued 'delete' op must land together or not at all,
 *  isolated from concurrent writers. Emit is handled one layer up (see
 *  enqueueOpWithCacheDeleteAndEmit in ./queue-events). */
export async function enqueueOpWithCacheDelete(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
  table: CachedTable,
  id: string,
): Promise<void> {
  const sql = await ready();
  await sql.withExclusiveTransactionAsync(async (txn) => {
    await deleteRow(txn, table, id);
    await insertOp(txn, op);
  });
}

/** Drain the entire queue ordered by `created_at` ASC (then id ASC as a
 *  stable tiebreak for ops enqueued in the same millisecond — the web
 *  IDB index sorts by created_at only, but its insertion-ordered key
 *  makes ties FIFO too; the explicit id tiebreak reproduces that). */
export async function dequeueAll(): Promise<QueuedOp[]> {
  const sql = await ready();
  const rows = await sql.getAllAsync<{
    id: number;
    created_at: number;
    table_name: string;
    op: string;
    row_id: string;
    payload: string;
    expected_updated_at: string | null;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT id, created_at, table_name, op, row_id, payload,
            expected_updated_at, attempts, last_error
       FROM sync_queue
       ORDER BY created_at ASC, id ASC`,
  );
  return rows.map(queueRowToOp);
}

export async function removeOp(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
}

export async function bumpAttempt(id: number, error: string): Promise<void> {
  const sql = await ready();
  // Match the web semantics: increment attempts, set last_error. A
  // missing row is a silent no-op (web reads-then-writes; the UPDATE …
  // WHERE id form is equivalent and skips the read).
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
    [error, id],
  );
}

/** Force an op's attempts to a high sentinel (999) so the replayer's
 *  `attempts >= MAX_ATTEMPTS` skip fires immediately, while keeping the
 *  row + last_error for the queue panel. Port of the web
 *  markOpPermanentlyFailed path (which lives in queue-events on web). */
export async function markOpPermanentlyFailed(
  id: number,
  error: string,
): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = 999, last_error = ? WHERE id = ?",
    [error, id],
  );
}

/** Manual-retry reset: attempts → 0 and clear last_error. Port of the
 *  web resetOpAttempts path. */
export async function resetOpAttempts(id: number): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    "UPDATE sync_queue SET attempts = 0, last_error = NULL WHERE id = ?",
    [id],
  );
}

export async function queueDepth(): Promise<number> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue",
  );
  return row?.n ?? 0;
}

// ─── Meta key-value (last-sync timestamps, cursor positions, …) ────────

export async function readMeta(key: string): Promise<string | null> {
  const sql = await ready();
  const row = await sql.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function writeMeta(key: string, value: string): Promise<void> {
  const sql = await ready();
  await sql.runAsync(
    `INSERT INTO sync_meta (key, value, updated_at)
       VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [key, value, Date.now()],
  );
}
