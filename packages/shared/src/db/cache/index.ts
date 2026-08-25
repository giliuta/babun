// STORY-054 — IndexedDB cache for offline-first reads + sync queue.
//
// One IndexedDB database (`babun-cache`) shared across all browsers
// /tabs of the same origin. Stores mirror the Supabase tables we
// chose for v1 (clients / appointments / client_tags) plus the
// outgoing-write queue and a per-table sync metadata key-value.
//
// Public surface is intentionally tiny — callers should only import
// the named functions exported at the bottom. Schema migration via
// `IDBPDatabase` upgrade callbacks; bumping `DB_VERSION` is the
// single trigger for evolving the schema (future: add `services`
// store when STORY-039b lands the catalog migration).
//
// Naming convention:
//   "tags"        = UI / code vocabulary (canonical in this module,
//                   in components, and in copy)
//   "client_tags" = DB table name (canonical in SQL migrations and
//                   in `database.types.ts`)
// They refer to the same data; the alias lives only in this cache
// layer + the type alias `CachedTag` below.
//
// Cross-tenant safety: `cacheClearAll()` MUST be called on logout
// from the Supabase `onAuthStateChange` handler when the event is
// `SIGNED_OUT`. Specifically: `await cacheClearAll()` BEFORE any UI
// state update so a fast logout-then-login-as-different-user flow
// can't leak the previous account's data through stale IDB. The
// integration point is wired in lib/sync/auth-clear.ts (G2/G3).
//
// Per-row `tenant_id` index keeps reads filtered when a single user
// belongs to multiple tenants. We never drop a partial table on
// tenant switch — realtime will overwrite stale rows lazily, and a
// stale view for ~1 second after a switch is acceptable.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Database } from "../database.types";

// ─── Cached row shapes (subsets of the public tables) ─────────────
// We don't try to mirror every column. The cache stores the columns
// the UI reads + the bookkeeping it needs (`tenant_id`, `updated_at`).
// If the UI starts reading new columns later, add them here and bump
// DB_VERSION.

export type CachedClient = Database["public"]["Tables"]["clients"]["Row"];
export type CachedAppointment =
  Database["public"]["Tables"]["appointments"]["Row"];
export type CachedTag = Database["public"]["Tables"]["client_tags"]["Row"];

export type CachedTable = "clients" | "appointments" | "tags";

// ─── Outgoing-write queue ─────────────────────────────────────────

export type QueuedOp = {
  /** autoIncrement; assigned by IDB on insert. */
  id: number;
  created_at: number; // ms epoch — used as replay order
  table: CachedTable;
  op: "insert" | "update" | "delete";
  /** UUID; for new rows we generate client-side so optimistic UI
   *  has a stable id from the start. */
  row_id: string;
  /** Insert / Update: full row to write (after the optimistic local
   *  edit). Delete: minimal `{ id, tenant_id }`. */
  payload: Record<string, unknown>;
  /** Conflict-detection sentinel for UPDATE. Set to the
   *  `updated_at` of the row at the time the op was queued. NULL on
   *  INSERT/DELETE (those don't conflict on updated_at). */
  expected_updated_at: string | null;
  attempts: number;
  last_error?: string;
};

// ─── DBSchema typing for `idb` ────────────────────────────────────

interface BabunCacheDB extends DBSchema {
  clients: {
    key: string;
    value: CachedClient;
    indexes: {
      tenant_id: string;
      updated_at: string;
      tenant_updated: [string, string];
    };
  };
  appointments: {
    key: string;
    value: CachedAppointment;
    indexes: {
      tenant_id: string;
      date: string;
      tenant_date: [string, string];
      tenant_updated: [string, string];
    };
  };
  tags: {
    key: string;
    value: CachedTag;
    indexes: {
      tenant_id: string;
    };
  };
  sync_queue: {
    key: number;
    value: QueuedOp;
    indexes: {
      created_at: number;
    };
  };
  sync_meta: {
    key: string;
    value: { key: string; value: string; updated_at: number };
  };
}

const DB_NAME = "babun-cache";
const DB_VERSION = 1;

// Singleton — opens once per page, reused for every call.
let dbPromise: Promise<IDBPDatabase<BabunCacheDB>> | null = null;

export async function getCache(): Promise<IDBPDatabase<BabunCacheDB>> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB not available (server-side import?)");
  }
  if (!dbPromise) {
    dbPromise = openDB<BabunCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // First-time install — build the whole schema. Later versions
        // can `if (oldVersion < N)` to add stores incrementally.
        if (oldVersion < 1) {
          const clients = db.createObjectStore("clients", { keyPath: "id" });
          clients.createIndex("tenant_id", "tenant_id");
          clients.createIndex("updated_at", "updated_at");
          clients.createIndex("tenant_updated", ["tenant_id", "updated_at"]);

          const appointments = db.createObjectStore("appointments", {
            keyPath: "id",
          });
          appointments.createIndex("tenant_id", "tenant_id");
          appointments.createIndex("date", "date");
          appointments.createIndex("tenant_date", ["tenant_id", "date"]);
          appointments.createIndex("tenant_updated", [
            "tenant_id",
            "updated_at",
          ]);

          const tags = db.createObjectStore("tags", { keyPath: "id" });
          tags.createIndex("tenant_id", "tenant_id");

          const queue = db.createObjectStore("sync_queue", {
            keyPath: "id",
            autoIncrement: true,
          });
          queue.createIndex("created_at", "created_at");

          db.createObjectStore("sync_meta", { keyPath: "key" });
        }
      },
      blocked() {
        // Another tab is holding an old version open. Caller should
        // either close other tabs or just wait — we'll resolve once
        // they yield. Log so we notice during dev.
        // eslint-disable-next-line no-console
        console.warn("babun-cache: upgrade blocked by another tab");
      },
      blocking() {
        // We're holding an older version while another tab wants to
        // upgrade. Close immediately so they can proceed.
        dbPromise?.then((d) => d.close()).catch(() => {});
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

// ─── Read API ─────────────────────────────────────────────────────

export async function cacheRead<T extends CachedClient | CachedAppointment | CachedTag>(
  table: CachedTable,
  tenantId: string,
): Promise<T[]> {
  const db = await getCache();
  const idx = db.transaction(table).store.index("tenant_id");
  const rows = await idx.getAll(tenantId);
  return rows as T[];
}

// ─── Write-through API (single row) ───────────────────────────────

export async function cacheUpsert<
  T extends CachedClient | CachedAppointment | CachedTag,
>(table: CachedTable, row: T): Promise<void> {
  const db = await getCache();
  await db.put(table, row);
}

export async function cacheDelete(
  table: CachedTable,
  id: string,
): Promise<void> {
  const db = await getCache();
  await db.delete(table, id);
}

// ─── Bulk API (bootstrap + reconnect resync) ──────────────────────

export async function cacheBulkUpsert<
  T extends CachedClient | CachedAppointment | CachedTag,
>(table: CachedTable, rows: T[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getCache();
  const tx = db.transaction(table, "readwrite");
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
}

/** Drop every row in `table` for a given tenant. Used before a
 *  bootstrap re-fetch so stale rows from a previous tenant context
 *  don't linger. We don't TRUNCATE the whole store because another
 *  tenant the user belongs to may still be using it.
 *
 *  Performance: cursor-delete is O(n) per matching row. Acceptable
 *  up to ~50k rows per tenant. If we ever exceed that — likely on a
 *  large multi-tenant agency — switch to one of:
 *    1. Batched index range delete (collect keys, then `.delete()`
 *       in a single transaction).
 *    2. Separate IndexedDB per tenant (one DB per workspace),
 *       which makes tenant-clear a single `deleteDatabase` call.
 *  Neither is needed for v1 scale. */
export async function cacheClearTenant(
  table: CachedTable,
  tenantId: string,
): Promise<void> {
  const db = await getCache();
  const tx = db.transaction(table, "readwrite");
  const idx = tx.store.index("tenant_id");
  let cursor = await idx.openCursor(tenantId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Wipe every store. Called on auth.signOut. */
export async function cacheClearAll(): Promise<void> {
  const db = await getCache();
  const tx = db.transaction(
    ["clients", "appointments", "tags", "sync_queue", "sync_meta"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("clients").clear(),
    tx.objectStore("appointments").clear(),
    tx.objectStore("tags").clear(),
    tx.objectStore("sync_queue").clear(),
    tx.objectStore("sync_meta").clear(),
  ]);
  await tx.done;
}

// ─── Queue API ────────────────────────────────────────────────────

export async function enqueueOp(
  op: Omit<QueuedOp, "id" | "created_at" | "attempts">,
): Promise<void> {
  const db = await getCache();
  const full: Omit<QueuedOp, "id"> = {
    ...op,
    created_at: Date.now(),
    attempts: 0,
  };
  await db.add("sync_queue", full as QueuedOp);
}

/** Drain the entire queue ordered by `created_at` ASC. */
export async function dequeueAll(): Promise<QueuedOp[]> {
  const db = await getCache();
  const idx = db.transaction("sync_queue").store.index("created_at");
  return idx.getAll();
}

export async function removeOp(id: number): Promise<void> {
  const db = await getCache();
  await db.delete("sync_queue", id);
}

export async function bumpAttempt(
  id: number,
  error: string,
): Promise<void> {
  const db = await getCache();
  const op = await db.get("sync_queue", id);
  if (!op) return;
  await db.put("sync_queue", {
    ...op,
    attempts: op.attempts + 1,
    last_error: error,
  });
}

export async function queueDepth(): Promise<number> {
  const db = await getCache();
  return db.count("sync_queue");
}

// ─── Meta key-value (last-sync timestamps, cursor positions, …) ──

export async function readMeta(key: string): Promise<string | null> {
  const db = await getCache();
  const row = await db.get("sync_meta", key);
  return row?.value ?? null;
}

export async function writeMeta(
  key: string,
  value: string,
): Promise<void> {
  const db = await getCache();
  await db.put("sync_meta", { key, value, updated_at: Date.now() });
}
