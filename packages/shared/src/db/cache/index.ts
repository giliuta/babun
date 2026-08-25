// Shared cache types.
//
// This module used to hold an IndexedDB implementation (the `idb` package)
// for the Next.js web app. That app was removed on 2026-08-25 — every
// platform now runs the SQLite backend in `./sql.ts` (expo-sqlite on
// native, its wasm build on web). What survives here are the type
// definitions both the cache and the outgoing-write queue are built on,
// kept in one place so `sql.ts` can re-export them and callers never care
// which backend they're talking to.

import type { Database } from "../database.types";

// ─── Cached row shapes (subsets of the public tables) ─────────────
// We don't try to mirror every column. The cache stores the columns
// the UI reads + the bookkeeping it needs (`tenant_id`, `updated_at`).

export type CachedClient = Database["public"]["Tables"]["clients"]["Row"];
export type CachedAppointment =
  Database["public"]["Tables"]["appointments"]["Row"];
export type CachedTag = Database["public"]["Tables"]["client_tags"]["Row"];

export type CachedTable = "clients" | "appointments" | "tags";

// ─── Outgoing-write queue ─────────────────────────────────────────

export type QueuedOp = {
  /** autoIncrement; assigned by the store on insert. */
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
