// Generic row CRUD over the cached tables.

import type { SqlAdapter } from "../../../storage/sql/types";
import type { CachedTable } from "../index";
import {
  bumpLocalWrite,
  parseRow,
  ready,
  serializeRow,
  tableName,
} from "./connection";
import type { CachedRow } from "./types";

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
  bumpLocalWrite(table);
  const sql = await ready();
  await upsertRow(sql, table, row);
}

/** Internal upsert usable inside an existing transaction (see
 *  enqueueOpWithCacheUpsert). Splits by table because the denormalised
 *  columns differ (appointments has `date`, tags has no `updated_at`). */
export async function upsertRow(
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
  bumpLocalWrite(table);
  const sql = await ready();
  await deleteRow(sql, table, id);
}

/** Internal delete usable inside an existing transaction (see
 *  enqueueOpWithCacheDelete). */
export async function deleteRow(
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
  bumpLocalWrite(table);
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
