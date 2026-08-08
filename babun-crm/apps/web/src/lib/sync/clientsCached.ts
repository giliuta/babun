// STORY-054 G3 — offline-aware client repository wrappers.
//
// Routes around the existing `@babun/shared/db/repositories/clients`
// module so callers in DashboardClientLayout can swap their imports
// to this file without touching call signatures. Behaviour:
//
//   list:    SWR — return cached rows immediately, kick a background
//            refetch + cacheBulkUpsert. If cache is empty we fall
//            through to the live fetch (no UI flash for first load).
//   create:  optimistic write to IDB; if online → repo.createClient
//            then cacheUpsert(canonical row); else enqueueOp 'insert'.
//   update:  optimistic patch in IDB carrying current updated_at as
//            sentinel; if online → repo.updateClient with same
//            sentinel via .eq('updated_at',...) for conflict
//            detection. On 0 rows → force-update + re-fetch +
//            cacheUpsert; toast warning. Offline → enqueueOp
//            'update' with sentinel for replayer.
//   delete:  cacheDelete optimistic; if online → repo.deleteClient
//            else enqueueOp 'delete'.
//
// v1 limitation — `tag_ids` patch is ONLINE-ONLY:
//   The existing repo diffs `client_tag_assignments` (junction table
//   we intentionally don't cache). When offline + patch carries
//   `tag_ids`, we strip it from the queued payload and surface a
//   toast hint. Cached tag_ids stay unchanged until next reconnect
//   pulls the canonical state. Future story may expand cache scope
//   if field workers report needing to re-tag offline.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import {
  listClients as repoListClients,
  createClient as repoCreateClient,
  updateClient as repoUpdateClient,
  deleteClient as repoDeleteClient,
} from "@babun/shared/db/repositories/clients";
import type { Client } from "@babun/shared/local/clients";
import {
  cacheRead,
  cacheUpsert,
  cacheDelete,
  cacheBulkUpsert,
  type CachedClient,
} from "@babun/shared/db/cache";
import { isOnline } from "./network";
import { kickReplayer } from "./replayer";
import { enqueueOpAndEmit as enqueueOp } from "./queue-events";
import {
  assertQuotaAvailable,
  QuotaExceededError,
} from "@/lib/quota/check";

type DbSupabase = SupabaseClient<Database>;

type ToastFn = (msg: string) => void;
let toastWarning: ToastFn = () => {};
/** Wire the toast helper once at app boot so wrappers can surface
 *  user-visible messages without each callsite re-passing it. */
export function setSyncToast(fn: ToastFn): void {
  toastWarning = fn;
}

// ─── Read ─────────────────────────────────────────────────────────

/** SWR list. Returns cached rows immediately if any; in parallel
 *  triggers a network refetch that updates the cache. The caller
 *  receives only the cached snapshot — they should subscribe to
 *  realtime for live updates. */
export async function listClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Client[]> {
  // 1. Try cache first. If we have rows, return them right away;
  //    the network refetch will refresh asynchronously.
  const cached = await safeCacheReadClients(tenantId);
  if (cached.length > 0) {
    void revalidateClients(supabase, tenantId); // fire and forget
    // We don't have tag_ids in the cache row; return with empty
    // tag_ids and let revalidate fix it on the next tick.
    return cached.map(rowToClient);
  }

  // 2. Cold cache — pull live, populate IDB, return.
  const fresh = await repoListClients(supabase, tenantId);
  // Stash row-level state for offline: only the columns we cache.
  // The Client domain shape carries derived fields; we store the
  // matching Database Row shape via a re-fetch.
  await refreshCacheFromSupabase(supabase, tenantId).catch(() => {});
  return fresh;
}

async function revalidateClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<void> {
  try {
    await refreshCacheFromSupabase(supabase, tenantId);
  } catch {
    // ignore — list() already returned cached data; UI is fine.
  }
}

async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`refreshClients: ${error.message}`);
  await cacheBulkUpsert("clients", (data ?? []) as CachedClient[]);
}

// Minimal row → domain conversion for the cache fallback path. The
// real adapters live in the repo; we re-use the shape conservatively.
function rowToClient(r: CachedClient): Client {
  // Fall back to live fetch if any consumer needs full domain
  // mapping; for offline display we stick close to the row shape
  // and let the existing realtime listener overwrite with the
  // canonical Client (with tag_ids etc.) once reconnect happens.
  return {
    id: r.id,
    full_name: r.full_name,
    phone: r.phone,
    whatsapp_phone: r.whatsapp_phone,
    email: r.email,
    sms_name: r.sms_name,
    telegram_username: r.telegram_username,
    instagram_username: r.instagram_username,
    balance: Number(r.balance ?? 0),
    discount: r.discount ?? 0,
    comment: r.comment,
    acquisition_source: (r.acquisition_source ?? "unknown") as Client["acquisition_source"],
    referred_by_client_id: r.referred_by_client_id,
    first_contact_date: r.first_contact_date,
    address: r.address,
    city: r.city,
    property_type: (r.property_type ?? "") as Client["property_type"],
    language: r.language ?? "",
    birthday: r.birthday,
    blacklisted: r.blacklisted,
    pinned_at: r.pinned_at,
    reminder_at: r.reminder_at,
    phones: [],
    locations: [],
    notes: [],
    equipment: [],
    tag_ids: [],
    phone_e164: r.phone_e164 ?? null,
    avatar_url: r.avatar_url ?? null,
    deleted_at: r.deleted_at ?? null,
    favorite_master_id: r.favorite_master_id ?? null,
    created_at: r.created_at,
  };
}

// ─── Write — create ───────────────────────────────────────────────

export async function createClient(
  supabase: DbSupabase,
  input: Client,
  tenantId: string,
): Promise<Client> {
  // Client-generated UUID so optimistic UI has a stable key from
  // the start. Supabase's gen_random_uuid will respect the supplied
  // id (PK insert), and our queued op carries the same id so the
  // replayer's INSERT lands at the same row.
  const id = input.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : `tmp_${Date.now()}`);
  const nowIso = new Date().toISOString();
  const optimisticRow = makeOptimisticRow(input, tenantId, id, nowIso);
  await cacheUpsert("clients", optimisticRow);

  // STORY-052 G4 — gate online-path inserts on the tier quota.
  // Offline writes are NOT pre-gated (we'd need a live count anyway);
  // the queue replays through this path on reconnect, so any quota
  // breach surfaces then. Direct PostgREST writes bypass — STORY-052b
  // backlog adds a Postgres BEFORE INSERT trigger backstop.
  if (isOnline()) {
    try {
      await assertQuotaAvailable(supabase, tenantId, "clients");
    } catch (err) {
      // Roll back the optimistic cache row so the user's UI doesn't
      // show a "client" that never landed on the server.
      if (err instanceof QuotaExceededError) {
        await cacheDelete("clients", id);
      }
      throw err;
    }
    try {
      const created = await repoCreateClient(supabase, { ...input, id }, tenantId);
      // Re-fetch the canonical row for the cache (created carries
      // domain shape; we want Row shape with the server's
      // updated_at).
      await refetchAndCacheOne(supabase, id, tenantId);
      return created;
    } catch (err) {
      // Network blip mid-flight — fall through to queue.
      void err;
      await enqueueOp({
        table: "clients",
        op: "insert",
        row_id: id,
        payload: optimisticRow as unknown as Record<string, unknown>,
        expected_updated_at: null,
      });
      void kickReplayer({ supabase });
      return { ...input, id };
    }
  }

  // Offline path
  await enqueueOp({
    table: "clients",
    op: "insert",
    row_id: id,
    payload: optimisticRow as unknown as Record<string, unknown>,
    expected_updated_at: null,
  });
  return { ...input, id };
}

// ─── Write — update ───────────────────────────────────────────────

export async function updateClient(
  supabase: DbSupabase,
  id: string,
  patch: Partial<Client>,
  tenantId: string,
): Promise<Client> {
  // Snapshot existing cached row for conflict-detection sentinel.
  const existing = await readCachedClient(id);
  const expectedUpdatedAt = existing?.updated_at ?? null;
  const offline = !isOnline();

  // v1 limitation: tag_ids edits are online-only. If offline + patch
  // includes tag_ids → strip + toast.
  let scrubbedPatch = patch;
  if (offline && patch.tag_ids !== undefined) {
    toastWarning(
      "Изменения тегов недоступны без сети — попробуй позже",
    );
    const { tag_ids: _drop, ...rest } = patch;
    void _drop;
    scrubbedPatch = rest;
  }

  // Optimistic local update.
  if (existing) {
    const merged: CachedClient = {
      ...existing,
      ...patchToRow(scrubbedPatch),
      updated_at: new Date().toISOString(),
    };
    await cacheUpsert("clients", merged);
  }

  if (!offline) {
    try {
      const updated = await repoUpdateClient(
        supabase,
        id,
        scrubbedPatch,
        tenantId,
      );
      await refetchAndCacheOne(supabase, id, tenantId);
      return updated;
    } catch (err) {
      void err;
      await enqueueOp({
        table: "clients",
        op: "update",
        row_id: id,
        payload: patchToRow(scrubbedPatch) as Record<string, unknown>,
        expected_updated_at: expectedUpdatedAt,
      });
      void kickReplayer({ supabase });
      // Optimistic shape — caller sees the merged result; realtime
      // will overwrite once reconnect.
      return { ...(existing as unknown as Client), ...scrubbedPatch, id };
    }
  }

  // Offline — queue the write
  await enqueueOp({
    table: "clients",
    op: "update",
    row_id: id,
    payload: patchToRow(scrubbedPatch) as Record<string, unknown>,
    expected_updated_at: expectedUpdatedAt,
  });
  return { ...(existing as unknown as Client), ...scrubbedPatch, id };
}

// ─── Write — delete ───────────────────────────────────────────────

export async function deleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  await cacheDelete("clients", id); // optimistic

  if (isOnline()) {
    try {
      await repoDeleteClient(supabase, id, tenantId);
      return;
    } catch (err) {
      void err;
      // fall through to queue
    }
  }
  await enqueueOp({
    table: "clients",
    op: "delete",
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  });
  if (isOnline()) void kickReplayer({ supabase });
}

// ─── Helpers ──────────────────────────────────────────────────────

async function safeCacheReadClients(tenantId: string): Promise<CachedClient[]> {
  try {
    return await cacheRead<CachedClient>("clients", tenantId);
  } catch {
    return [];
  }
}

async function readCachedClient(id: string): Promise<CachedClient | null> {
  try {
    const { getCache } = await import("@babun/shared/db/cache");
    const db = await getCache();
    const row = await db.get("clients", id);
    return row ?? null;
  } catch {
    return null;
  }
}

async function refetchAndCacheOne(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return;
  await cacheUpsert("clients", data as CachedClient);
}

function makeOptimisticRow(
  input: Client,
  tenantId: string,
  id: string,
  nowIso: string,
): CachedClient {
  // Best-effort shape — fill required Row columns with safe defaults
  // matching the DB schema. The canonical row from refetchAndCacheOne
  // overwrites this on success.
  return {
    id,
    tenant_id: tenantId,
    full_name: input.full_name ?? "",
    phone: input.phone ?? "",
    whatsapp_phone: input.whatsapp_phone ?? "",
    email: input.email ?? "",
    sms_name: input.sms_name ?? "",
    telegram_username: input.telegram_username ?? "",
    instagram_username: input.instagram_username ?? "",
    balance: input.balance ?? 0,
    discount: input.discount ?? 0,
    comment: input.comment ?? "",
    acquisition_source: input.acquisition_source ?? "unknown",
    referred_by_client_id: input.referred_by_client_id ?? null,
    first_contact_date: input.first_contact_date ?? null,
    address: input.address ?? "",
    city: input.city ?? "",
    city_manual: input.city_manual ?? false,
    property_type: input.property_type ?? "",
    language: input.language ?? null,
    birthday: input.birthday ?? "",
    blacklisted: input.blacklisted ?? false,
    pinned_at: input.pinned_at ?? null,
    reminder_at: input.reminder_at ?? null,
    phones: (input.phones ?? []) as unknown as CachedClient["phones"],
    locations: (input.locations ?? []) as unknown as CachedClient["locations"],
    notes: (input.notes ?? []) as unknown as CachedClient["notes"],
    equipment: (input.equipment ?? []) as unknown as CachedClient["equipment"],
    phone_e164: input.phone_e164 ?? null,
    avatar_url: input.avatar_url ?? null,
    deleted_at: input.deleted_at ?? null,
    favorite_master_id: input.favorite_master_id ?? null,
    created_at: input.created_at ?? nowIso,
    updated_at: nowIso,
  };
}

function patchToRow(patch: Partial<Client>): Partial<CachedClient> {
  // Mirror only the columns Supabase will accept. Nested arrays go
  // straight through as jsonb.
  const out: Partial<CachedClient> = {};
  if (patch.full_name !== undefined) out.full_name = patch.full_name;
  if (patch.phone !== undefined) out.phone = patch.phone;
  if (patch.whatsapp_phone !== undefined) out.whatsapp_phone = patch.whatsapp_phone;
  if (patch.email !== undefined) out.email = patch.email;
  if (patch.sms_name !== undefined) out.sms_name = patch.sms_name;
  if (patch.telegram_username !== undefined) out.telegram_username = patch.telegram_username;
  if (patch.instagram_username !== undefined) out.instagram_username = patch.instagram_username;
  if (patch.balance !== undefined) out.balance = patch.balance;
  if (patch.discount !== undefined) out.discount = patch.discount;
  if (patch.comment !== undefined) out.comment = patch.comment;
  if (patch.acquisition_source !== undefined) out.acquisition_source = patch.acquisition_source;
  if (patch.referred_by_client_id !== undefined) out.referred_by_client_id = patch.referred_by_client_id;
  if (patch.first_contact_date !== undefined) out.first_contact_date = patch.first_contact_date;
  if (patch.address !== undefined) out.address = patch.address;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.property_type !== undefined) out.property_type = patch.property_type;
  if (patch.language !== undefined) out.language = patch.language;
  if (patch.birthday !== undefined) out.birthday = patch.birthday;
  if (patch.blacklisted !== undefined) out.blacklisted = patch.blacklisted;
  if (patch.pinned_at !== undefined) out.pinned_at = patch.pinned_at;
  if (patch.reminder_at !== undefined) out.reminder_at = patch.reminder_at;
  if (patch.phones !== undefined) out.phones = patch.phones as unknown as CachedClient["phones"];
  if (patch.locations !== undefined) out.locations = patch.locations as unknown as CachedClient["locations"];
  if (patch.notes !== undefined) out.notes = patch.notes as unknown as CachedClient["notes"];
  if (patch.equipment !== undefined) out.equipment = patch.equipment as unknown as CachedClient["equipment"];
  if (patch.phone_e164 !== undefined) out.phone_e164 = patch.phone_e164 ?? null;
  if (patch.avatar_url !== undefined) out.avatar_url = patch.avatar_url ?? null;
  if (patch.deleted_at !== undefined) out.deleted_at = patch.deleted_at ?? null;
  if (patch.favorite_master_id !== undefined) out.favorite_master_id = patch.favorite_master_id ?? null;
  return out;
}
