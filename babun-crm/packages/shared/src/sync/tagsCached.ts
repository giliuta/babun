// STORY-062 slice 3 — shared offline-aware tag repository wrappers.
//
// Port of apps/web/src/lib/sync/tagsCached.ts. Backend-neutral changes only:
//   1. SQLite cache (`../db/cache/sql`); `readCachedTag` uses `cacheGetOne`.
//   2. `crypto.randomUUID()` → `randomUuid()` (RN-safe).
// No quota gate here — the web original never gated tags.
//
// IMPORTANT — tag conflict detection is SKIPPED:
//   public.client_tags does not have an `updated_at` column. We therefore
//   can't issue UPDATE WHERE updated_at = $2 for last-write-wins detection.
//   All tag operations queue with expected_updated_at: null → unconditional
//   last-write-wins on replay → no warning toast on tag conflicts.
//   Acceptable: tags are <100 rows per tenant and rarely change.
//
// `client_tag_assignments` (the junction) is NOT cached either, see the
// cache layer header. Tag membership for a client requires online
// connectivity to mutate. Decision #2 from G0: full re-pull on each sync.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/database.types";
import {
  listClientTags as repoListClientTags,
  createClientTag as repoCreateClientTag,
  updateClientTag as repoUpdateClientTag,
  deleteClientTag as repoDeleteClientTag,
} from "../db/repositories/clients";
import type { ClientTag } from "../local/clients";
import {
  cacheRead,
  cacheUpsert,
  cacheDelete,
  cacheBulkUpsert,
  cacheGetOne,
  type CachedTag,
} from "../db/cache/sql";
import { isOnline } from "./network";
import { kickReplayer } from "./replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
} from "./queue-events";
import { randomUuid } from "./uuid";

type DbSupabase = SupabaseClient<Database>;

// ─── Read ─────────────────────────────────────────────────────────

export async function listClientTags(
  supabase: DbSupabase,
  tenantId: string,
): Promise<ClientTag[]> {
  const cached = await safeCacheReadTags(tenantId);
  if (cached.length > 0) {
    void revalidateTags(supabase, tenantId);
    return cached.map(rowToTag);
  }
  // Cold cache. If offline, repoListClientTags will throw — we
  // catch and return empty. UI shows no tag chips until reconnect.
  try {
    const fresh = await repoListClientTags(supabase, tenantId);
    await refreshCacheFromSupabase(supabase, tenantId).catch(() => {});
    return fresh;
  } catch {
    return [];
  }
}

async function revalidateTags(
  supabase: DbSupabase,
  tenantId: string,
): Promise<void> {
  try {
    await refreshCacheFromSupabase(supabase, tenantId);
  } catch {
    /* ignore */
  }
}

async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("client_tags")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`refreshTags: ${error.message}`);
  await cacheBulkUpsert("tags", (data ?? []) as CachedTag[]);
}

function rowToTag(r: CachedTag): ClientTag {
  return { id: r.id, name: r.name, color: r.color };
}

// ─── Write ────────────────────────────────────────────────────────

export async function createClientTag(
  supabase: DbSupabase,
  input: { name: string; color: string },
  tenantId: string,
): Promise<ClientTag> {
  const id = randomUuid();
  const optimisticRow: CachedTag = {
    id,
    tenant_id: tenantId,
    name: input.name,
    color: input.color,
  };
  const insertOp = {
    table: "tags" as const,
    op: "insert" as const,
    row_id: id,
    payload: optimisticRow as unknown as Record<string, unknown>,
    expected_updated_at: null,
  };

  if (isOnline()) {
    // Optimistic UI first (standalone online — no queued op to pair with).
    await cacheUpsert("tags", optimisticRow);
    try {
      const created = await repoCreateClientTag(supabase, input, tenantId);
      // Server-generated id wins. Replace the optimistic row with
      // the canonical one (delete the temp + insert the real).
      if (created.id !== id) {
        await cacheDelete("tags", id);
      }
      await cacheUpsert("tags", {
        id: created.id,
        tenant_id: tenantId,
        name: created.name,
        color: created.color,
      });
      return created;
    } catch (err) {
      // Network blip — ATOMIC optimistic upsert + enqueue (risk #6).
      void err;
      await enqueueOpWithCacheUpsertAndEmit(insertOp, "tags", optimisticRow);
      void kickReplayer({ supabase });
      return { id, name: input.name, color: input.color };
    }
  }

  // Offline — ATOMIC optimistic upsert + enqueue (risk #6).
  await enqueueOpWithCacheUpsertAndEmit(insertOp, "tags", optimisticRow);
  return { id, name: input.name, color: input.color };
}

export async function updateClientTag(
  supabase: DbSupabase,
  id: string,
  patch: { name?: string; color?: string },
  tenantId: string,
): Promise<ClientTag> {
  const existing = await readCachedTag(id, tenantId);
  const merged: CachedTag | null = existing
    ? { ...existing, ...patch }
    : null;
  const updateOp = {
    table: "tags" as const,
    op: "update" as const,
    row_id: id,
    payload: patch as Record<string, unknown>,
    expected_updated_at: null, // no updated_at column → no detection
  };

  if (isOnline()) {
    // Online: standalone optimistic upsert (no queued op to pair with).
    if (merged) await cacheUpsert("tags", merged);
    try {
      const updated = await repoUpdateClientTag(supabase, id, patch, tenantId);
      await cacheUpsert("tags", {
        id: updated.id,
        tenant_id: tenantId,
        name: updated.name,
        color: updated.color,
      });
      return updated;
    } catch (err) {
      void err;
      await enqueueTagUpdate(updateOp, merged);
      void kickReplayer({ supabase });
      return {
        id,
        name: patch.name ?? existing?.name ?? "",
        color: patch.color ?? existing?.color ?? "",
      };
    }
  }

  // Offline — ATOMIC with the optimistic row when cached (risk #6).
  await enqueueTagUpdate(updateOp, merged);
  return {
    id,
    name: patch.name ?? existing?.name ?? "",
    color: patch.color ?? existing?.color ?? "",
  };
}

/** Enqueue a tag update op, pairing it atomically with the optimistic
 *  merged row when the tag was cached (risk #6); plain emit-enqueue when
 *  it wasn't (matches the prior `if (existing)` guard). */
async function enqueueTagUpdate(
  op: Parameters<typeof enqueueOpAndEmit>[0],
  merged: CachedTag | null,
): Promise<void> {
  if (merged) {
    await enqueueOpWithCacheUpsertAndEmit(op, "tags", merged);
  } else {
    await enqueueOpAndEmit(op);
  }
}

export async function deleteClientTag(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const deleteOp = {
    table: "tags" as const,
    op: "delete" as const,
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  };

  if (isOnline()) {
    await cacheDelete("tags", id); // optimistic (standalone online)
    try {
      await repoDeleteClientTag(supabase, id, tenantId);
      return;
    } catch {
      // Fall through — ATOMIC optimistic delete + enqueue (risk #6).
      await enqueueOpWithCacheDeleteAndEmit(deleteOp, "tags", id);
      void kickReplayer({ supabase });
      return;
    }
  }

  // Offline — ATOMIC optimistic delete + enqueue (risk #6).
  await enqueueOpWithCacheDeleteAndEmit(deleteOp, "tags", id);
}

// ─── Helpers ──────────────────────────────────────────────────────

async function safeCacheReadTags(tenantId: string): Promise<CachedTag[]> {
  try {
    return await cacheRead<CachedTag>("tags", tenantId);
  } catch {
    return [];
  }
}

async function readCachedTag(
  id: string,
  tenantId?: string,
): Promise<CachedTag | null> {
  try {
    // Tenant-scope the single-row read to the active tenant (minor).
    return await cacheGetOne<CachedTag>("tags", id, tenantId);
  } catch {
    return null;
  }
}
