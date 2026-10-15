// Tag reads: SWR list, authoritative cache refresh and cache helpers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import { listClientTags as repoListClientTags } from "../../db/repositories/clients";
import type { ClientTag } from "../../local/clients";
import {
  cacheRead,
  cacheReplaceTenant,
  cacheGetOne,
  dequeueAll,
  cacheLocalWriteSeq,
  type CachedTag,
} from "../../db/cache/sql";
import { isOnline } from "../network";
import { kickReplayer, tenantRefreshHeld } from "../replayer";
import { cacheSignature } from "../revalidate-events";
import { createRevalidator } from "../revalidator";
import { rowToTag, serverTagToCachedRow } from "./rows";

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
    // Счётчик — ДО запроса (`cacheLocalWriteSeq`, как у записей и клиентов).
    const writeSeq = cacheLocalWriteSeq("tags");
    const fresh = await repoListClientTags(supabase, tenantId);
    await refreshCacheFromSupabase(supabase, tenantId, fresh, writeSeq).catch(() => {});
    return fresh;
  } catch (err) {
    if (isOnline()) throw err;
    return [];
  }
}

const tagsRevalidator = createRevalidator<DbSupabase>("tags", (sb, tenantId) =>
  refreshCacheFromSupabase(sb, tenantId),
);
const revalidateTags = tagsRevalidator.revalidate;

/** Slice 5 — AUTHORITATIVE + REVALIDATE-BRIDGE. `cacheReplaceTenant` prunes
 *  tags deleted on another device; the signature diff (which folds the whole
 *  tag row — client_tags has no `updated_at`, so a rename/recolour still
 *  registers) drives the bridge emit. Returns whether anything changed.
 *
 *  ПРАВКА, ЛЕГШАЯ ЗА ВРЕМЯ ЗАПРОСА, НЕ ЗАТИРАЕТСЯ: иначе удалённый
 *  тег воскресал бы (а поставить его давало 23503), новый исчезал бы,
 *  переименование откатывалось бы. Замена отменяется, если с начала запроса в
 *  кэш тегов писали, и следом идёт вторая сверка. */
async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
  domain?: ClientTag[],
  /** Счётчик локальных записей, снятый до запроса `domain` (холодный путь). */
  writeSeqAtFetch?: number,
): Promise<boolean> {
  const writeSeq = writeSeqAtFetch ?? cacheLocalWriteSeq("tags");
  // Preserve optimistic offline tags until replay finishes. Otherwise the
  // first reconnect snapshot naturally lacks the not-yet-inserted tag and
  // `cacheReplaceTenant` makes it disappear before the queued write runs.
  const pending = await dequeueAll();
  if (
    tenantRefreshHeld(pending, "tags", tenantId)
  ) {
    void kickReplayer({ supabase });
    return false;
  }
  const tags = domain ?? (await repoListClientTags(supabase, tenantId));
  const rows: CachedTag[] = tags.map((tag) => serverTagToCachedRow(tag, tenantId));
  const before = cacheSignature(await safeCacheReadTags(tenantId));
  const replaced = await cacheReplaceTenant("tags", tenantId, rows, {
    unlessLocalWriteSince: writeSeq,
  });
  if (!replaced) {
    tagsRevalidator.markStale(tenantId);
    return false;
  }
  const after = cacheSignature(rows);
  return before !== after;
}

// ─── Helpers ──────────────────────────────────────────────────────

async function safeCacheReadTags(tenantId: string): Promise<CachedTag[]> {
  try {
    return await cacheRead<CachedTag>("tags", tenantId);
  } catch {
    return [];
  }
}

export async function readCachedTag(
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
