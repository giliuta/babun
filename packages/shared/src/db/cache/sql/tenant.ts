// Tenant-wide cache operations (authoritative replace, clears) and the
// sync_meta key-value store they share.

import type { CachedTable } from "../index";
import { cacheLocalWriteSeq, ready, tableName } from "./connection";
import { upsertRow } from "./rows";
import type { CachedRow } from "./types";

const AUTHORITATIVE_SNAPSHOT_PREFIX = "authoritative-snapshot";

function authoritativeSnapshotKey(
  table: CachedTable,
  tenantId: string,
): string {
  return `${AUTHORITATIVE_SNAPSHOT_PREFIX}:${table}:${tenantId}`;
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
  opts?: {
    /** Счётчик `cacheLocalWriteSeq(table)`, снятый ДО запроса снимка. Если
     *  с тех пор приложение писало в таблицу, замена не делается: снимок
     *  старше правки. Ответ `false` — «не заменено, сверьте ещё раз». */
    unlessLocalWriteSince?: number;
  },
): Promise<boolean> {
  const sql = await ready();
  let skipped = false;
  await sql.withExclusiveTransactionAsync(async (txn) => {
    if (
      opts?.unlessLocalWriteSince !== undefined &&
      cacheLocalWriteSeq(table) !== opts.unlessLocalWriteSince
    ) {
      skipped = true;
      return;
    }
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
  return !skipped;
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

/** Wipe every table (both queues too). Called on auth.signOut (cross-tenant leak guard —
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
       DELETE FROM member_queue;
       DELETE FROM sync_meta;`,
    );
  });
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
