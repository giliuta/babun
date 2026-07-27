// STORY-062 slice 3 — shared offline-aware client repository wrappers.
//
// Port of apps/web/src/lib/sync/clientsCached.ts. Same public surface and
// same behaviour; the only changes are backend-neutral plumbing:
//   1. Cache comes from the SQLite cache (`../db/cache/sql`) instead of the
//      IndexedDB cache. `readCachedClient` uses `cacheGetOne(table, id)` —
//      the SQLite first-class single-row read — in place of the web's
//      `(await getCache()).get(table, id)` (IDBPDatabase API, no SQLite
//      analogue).
//   2. The web-only quota module (`@/lib/quota/check`) stays out of this
//      host-neutral wrapper. Mobile performs the live preflight in its create
//      hook and injects the same policy into the replayer for offline writes;
//      the database remains the final race-safe authority.
//   3. `crypto.randomUUID()` → `randomUuid()` (RN-safe; the polyfill has no
//      crypto.randomUUID — see ./uuid).
//
// Original behaviour preserved verbatim:
//   list:    SWR — cached rows immediately + background refetch/cacheBulkUpsert.
//   create:  optimistic cacheUpsert; online → repo.createClient +
//            refetchAndCacheOne (on error → enqueue+kick); offline → enqueueOp.
//   update:  optimistic patch carrying updated_at sentinel; online →
//            repo.updateClient (on error → enqueue+kick); offline → enqueueOp.
//   archive: cacheDelete optimistic; online → repo.softDeleteClient, otherwise
//            enqueue an UPDATE {deleted_at}; legal/history rows stay linked.
//
// Slice 5 — cache-of-DOMAIN. The cache `data` column now stores the FULL
// `Client` domain object (WITH `tag_ids` + nested phones/locations/notes/
// equipment) decorated with the two bookkeeping keys the domain shape
// itself lacks (`tenant_id`, `updated_at`). `rowToClient` returns it whole
// so an online read-from-cache is byte-identical to a live repo read — no
// more emptied `tag_ids` / nested-field regression. The revalidate path
// pulls the canonical domain list via `repoListClients` (which joins the
// junction) so background refresh keeps `tag_ids` accurate too.
//
// TWO PROJECTIONS (offline-plan rule 4). What lands in the queue payload is
// the RAW DB-column projection the server accepts (built by `makeServerRow`
// / `patchToRow` — NO `tag_ids`, nested arrays as jsonb). What lands in the
// cache `data` is the full domain object (built by `makeCachedRow` /
// `mergeCachedRow`). The two never mix: dispatch relays `payload` straight
// to PostgREST; reads parse `data`.
//
// v1 limitation — `tag_ids` patch is ONLINE-ONLY: the junction write path
// lives in the repo (online) and the replayer can't diff assignments, so
// offline + patch carrying tag_ids → strip + toast.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/database.types";
import {
  listClients as repoListClients,
  getClient as repoGetClient,
  createClient as repoCreateClient,
  updateClient as repoUpdateClient,
  deleteClient as repoDeleteClient,
  softDeleteClient as repoSoftDeleteClient,
  restoreClient as repoRestoreClient,
} from "../db/repositories/clients";
import type { Client } from "../local/clients";
import {
  cacheRead,
  cacheUpsert,
  cacheDelete,
  cacheReplaceTenant,
  cacheGetOne,
  hasAuthoritativeTenantSnapshot,
  dequeueAll,
  type CachedClient,
  type CachedClientData,
} from "../db/cache/sql";
import { isOnline } from "./network";
import { kickReplayer, MAX_ATTEMPTS } from "./replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
} from "./queue-events";
import { emitRevalidated, cacheSignature } from "./revalidate-events";
import { randomUuid } from "./uuid";
import { ColdOfflineCacheMissError } from "./cache-errors";

type DbSupabase = SupabaseClient<Database>;

type ToastFn = (msg: string) => void;
let toastWarning: ToastFn = () => {};
/** Wire the toast helper once at app boot so wrappers can surface
 *  user-visible messages without each callsite re-passing it. */
export function setSyncToast(fn: ToastFn): void {
  toastWarning = fn;
}

// Only transport failures belong in the offline replay queue. A server-side
// RLS, validation or business-rule rejection is permanent for this payload;
// queueing it would make the optimistic UI lie and retry forever.
function isTransientNetworkError(err: unknown): boolean {
  const withStatus = err as { status?: unknown; statusCode?: unknown };
  const status =
    typeof withStatus?.status === "number"
      ? withStatus.status
      : typeof withStatus?.statusCode === "number"
        ? withStatus.statusCode
        : 0;
  if (status >= 500) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /failed to fetch|load failed|network request failed|network error|fetch failed|timed? ?out|socket|econn|abort|bad gateway|service unavailable|gateway time|\b50[234]\b/i.test(
    message,
  );
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
  //    the network refetch will refresh asynchronously. The cached
  //    rows are FULL domain objects (with tag_ids + nested fields), so
  //    the returned list matches a live repo read.
  const cached = await safeCacheReadClients(tenantId);
  if (cached.length > 0) {
    void revalidateClients(supabase, tenantId); // fire and forget
    return cached.map(rowToClient);
  }

  // 2. Empty cache — pull the canonical domain list and mark even a genuine
  //    server [] as authoritative. Without that marker, offline [] means
  //    «unknown / never synced», not «this tenant has no clients».
  try {
    const fresh = await repoListClients(supabase, tenantId);
    await refreshCacheFromSupabase(supabase, tenantId, fresh).catch(() => {});
    return fresh;
  } catch (err) {
    // With a live connection, RLS/server failures reach the screen. Offline
    // may reuse a known-empty authoritative snapshot; a never-synced device
    // gets a typed blocked state instead of an invitation to create duplicates.
    if (isOnline()) throw err;
    const hasSnapshot = await hasAuthoritativeTenantSnapshot(
      "clients",
      tenantId,
    ).catch(() => false);
    if (hasSnapshot) return [];
    throw new ColdOfflineCacheMissError("clients");
  }
}

async function revalidateClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<void> {
  try {
    const changed = await refreshCacheFromSupabase(supabase, tenantId);
    // Emit only on a real change so the mobile bridge's invalidate →
    // refetch → revalidate cycle settles after one pass (loop guard).
    if (changed) emitRevalidated("clients");
  } catch {
    // ignore — list() already returned cached data; UI is fine.
  }
}

/** Refill the cache with the canonical DOMAIN list (tag_ids + nested
 *  fields intact). `repoListClients` joins the junction table for us; we
 *  then decorate each `Client` with the bookkeeping keys the cache layer
 *  needs (tenant_id for scoping, updated_at for the LWW sentinel) — the
 *  latter pulled in a light id/updated_at select the domain list drops.
 *
 *  Callers on the cold path pass the already-fetched `domain` to avoid a
 *  second list round-trip.
 *
 *  Slice 5 — AUTHORITATIVE + REVALIDATE-BRIDGE. Uses `cacheReplaceTenant`
 *  (delete-then-fill) so a client deleted on another device is pruned from
 *  the cache, not left as a phantom row. Diffs the fresh server signature
 *  against the pre-refresh cache signature and returns whether it changed —
 *  the SWR caller emits `revalidated` only on a real change (loop guard). */
async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
  domain?: Client[],
): Promise<boolean> {
  // Never let an authoritative snapshot erase an optimistic client while its
  // offline mutation is still waiting in the replay queue. Permanently failed
  // ops stop blocking after MAX_ATTEMPTS, allowing the next server snapshot
  // to heal a rejected optimistic row.
  const pending = await dequeueAll();
  if (
    pending.some(
      (op) => op.table === "clients" && op.attempts < MAX_ATTEMPTS,
    )
  ) {
    void kickReplayer({ supabase });
    return false;
  }
  const clients = domain ?? (await repoListClients(supabase, tenantId));
  const updatedById = await fetchUpdatedAtById(supabase, tenantId);
  const rows = clients.map((c) =>
    makeCachedRow(c, tenantId, updatedById.get(c.id)),
  );
  // Signature BEFORE the write — what the UI is currently showing.
  const before = cacheSignature(await safeCacheReadClients(tenantId));
  await cacheReplaceTenant("clients", tenantId, rows);
  const after = cacheSignature(rows);
  return before !== after;
}

/** Map id → updated_at for the tenant's clients. The domain `Client`
 *  shape drops `updated_at`; we need it for the cache's denorm column +
 *  the LWW conflict sentinel, so pull it in a tiny separate projection. */
async function fetchUpdatedAtById(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, updated_at")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`refreshClients meta: ${error.message}`);
    const page = data ?? [];
    for (const r of page) {
      if (r.updated_at) map.set(r.id, r.updated_at);
    }
    if (page.length < pageSize) break;
  }
  return map;
}

// Cache row → domain. The cache stores the full domain object decorated
// with tenant_id + updated_at; strip those two bookkeeping keys and return
// a clean `Client` (identical to what the repo list returns).
function rowToClient(r: CachedClientData): Client {
  const { tenant_id: _t, updated_at: _u, ...client } = r;
  void _t;
  void _u;
  return client;
}

/** Build the DOMAIN cache row (what lands in `data`) from a canonical
 *  `Client`. Carries tag_ids + nested fields verbatim + the two
 *  bookkeeping keys. */
function makeCachedRow(
  client: Client,
  tenantId: string,
  updatedAt: string | undefined,
): CachedClientData {
  return {
    ...client,
    tenant_id: tenantId,
    updated_at: updatedAt ?? new Date().toISOString(),
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
  const id = input.id || randomUuid();
  const nowIso = new Date().toISOString();
  // Two projections (rule 4):
  //   cachedRow — full DOMAIN object for reads (tag_ids + nested intact).
  //   serverRow — raw DB columns for the queue payload the replayer INSERTs.
  const cachedRow = makeCachedRow({ ...input, id }, tenantId, nowIso);
  const serverRow = makeServerRow(input, tenantId, id, nowIso);
  const insertOp = {
    table: "clients" as const,
    op: "insert" as const,
    row_id: id,
    // `__tag_ids` is queue metadata, not a database column. The replayer
    // strips it before inserting the client and then idempotently upserts the
    // junction rows. Without this, tags selected on an offline new-client
    // draft looked saved locally and vanished on the next server refresh.
    payload: {
      ...(serverRow as unknown as Record<string, unknown>),
      __tag_ids: input.tag_ids ?? [],
    },
    expected_updated_at: null,
  };

  if (isOnline()) {
    // Optimistic UI first (standalone upsert is fine online — there is no
    // queued op to keep it atomic with; the server write follows).
    await cacheUpsert("clients", cachedRow);
    try {
      const created = await repoCreateClient(supabase, { ...input, id }, tenantId);
      // Re-fetch the canonical DOMAIN row for the cache (with the server's
      // updated_at + any server-side defaults).
      await refetchAndCacheOne(supabase, id, tenantId);
      return created;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        await cacheDelete("clients", id).catch(() => {});
        throw err;
      }
      // Network blip mid-flight — fall through to queue. ATOMIC (risk #6):
      // the optimistic row + the queued op land in one exclusive tx so a
      // crash between them can't strand one without the other.
      await enqueueOpWithCacheUpsertAndEmit(insertOp, "clients", cachedRow);
      void kickReplayer({ supabase });
      return { ...input, id };
    }
  }

  // Offline path — ATOMIC optimistic upsert + enqueue (risk #6).
  await enqueueOpWithCacheUpsertAndEmit(insertOp, "clients", cachedRow);
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
  const existing = await readCachedClient(id, tenantId);
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

  // Optimistic local update — computed once so the offline / error paths
  // can enqueue it ATOMICALLY with the queued op (risk #6). The cache
  // merge is DOMAIN-shaped (patch applied to the full domain object), while
  // the queue payload stays the raw-column projection (rule 4).
  const merged: CachedClientData | null = existing
    ? {
        ...existing,
        ...scrubbedPatch,
        // updated_at НЕ трогаем: это СЕРВЕРНЫЙ сентинел, и он же уезжает в
        // очередь как expected_updated_at. Локальный штамп означал, что
        // следующая офлайн-правка отправляла серверу «ожидаю версию, которой
        // на сервере никогда не было» — и каждая вторая правка возвращалась
        // ложным «конфликтом синхронизации». Новое значение придёт с
        // сервера, когда операция реально применится.
      }
    : null;
  const updateOp = {
    table: "clients" as const,
    op: "update" as const,
    row_id: id,
    payload: patchToRow(scrubbedPatch) as Record<string, unknown>,
    expected_updated_at: expectedUpdatedAt,
  };

  if (!offline) {
    // Online: standalone optimistic upsert (no queued op to pair with).
    if (merged) await cacheUpsert("clients", merged);
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
      if (!isTransientNetworkError(err)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      await enqueueUpdate(updateOp, merged);
      void kickReplayer({ supabase });
      // Optimistic shape — caller sees the merged result; realtime
      // will overwrite once reconnect.
      return { ...toDomain(existing), ...scrubbedPatch, id } as Client;
    }
  }

  // Offline — queue the write (ATOMIC with the optimistic row when we have
  // one; plain enqueue when the row wasn't cached yet).
  await enqueueUpdate(updateOp, merged);
  return { ...toDomain(existing), ...scrubbedPatch, id } as Client;
}

/** Domain view of a cached row (drops the bookkeeping keys), or an empty
 *  patch base when the row wasn't cached. Used to build the optimistic
 *  return shape without leaking tenant_id/updated_at into the Client. */
function toDomain(existing: CachedClientData | null): Partial<Client> {
  return existing ? rowToClient(existing) : {};
}

/** Enqueue an update op, pairing it in one exclusive transaction with the
 *  optimistic merged row when there is one (risk #6). When the row was not
 *  in the cache (merged === null) there is nothing to upsert, so a plain
 *  emit-enqueue matches the prior behaviour (the `if (existing)` guard). */
async function enqueueUpdate(
  op: Parameters<typeof enqueueOpAndEmit>[0],
  merged: CachedClientData | null,
): Promise<void> {
  if (merged) {
    await enqueueOpWithCacheUpsertAndEmit(op, "clients", merged);
  } else {
    await enqueueOpAndEmit(op);
  }
}

// ─── Write — delete ───────────────────────────────────────────────

/** Product-level removal: archive the client while preserving linked jobs,
 * invoices and ledger history. The active-list cache removes the row, but the
 * offline queue carries UPDATE deleted_at — never DELETE. */
export async function archiveClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const existing = await readCachedClient(id, tenantId);
  const archivedAt = new Date().toISOString();
  const archiveOp = {
    table: "clients" as const,
    op: "update" as const,
    row_id: id,
    payload: { deleted_at: archivedAt },
    expected_updated_at: existing?.updated_at ?? null,
  };

  if (isOnline()) {
    await cacheDelete("clients", id);
    try {
      await repoSoftDeleteClient(supabase, id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      await enqueueOpWithCacheDeleteAndEmit(archiveOp, "clients", id);
      void kickReplayer({ supabase });
      return;
    }
  }

  await enqueueOpWithCacheDeleteAndEmit(archiveOp, "clients", id);
}

/** Restore an archived client into the active-list cache. Supplying the
 * archived domain row makes the offline result immediately reachable while
 * the queued UPDATE waits for connectivity. */
export async function restoreClient(
  supabase: DbSupabase,
  client: Client,
  tenantId: string,
): Promise<void> {
  const restoredAt = new Date().toISOString();
  const cachedRow = makeCachedRow(
    { ...client, deleted_at: null },
    tenantId,
    restoredAt,
  );
  const restoreOp = {
    table: "clients" as const,
    op: "update" as const,
    row_id: client.id,
    payload: { deleted_at: null },
    expected_updated_at: null,
  };

  if (isOnline()) {
    await cacheUpsert("clients", cachedRow);
    try {
      await repoRestoreClient(supabase, client.id, tenantId);
      await refetchAndCacheOne(supabase, client.id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        await cacheDelete("clients", client.id).catch(() => {});
        throw err;
      }
      await enqueueOpWithCacheUpsertAndEmit(
        restoreOp,
        "clients",
        cachedRow,
      );
      void kickReplayer({ supabase });
      return;
    }
  }

  await enqueueOpWithCacheUpsertAndEmit(restoreOp, "clients", cachedRow);
}

/** Low-level physical delete retained for maintenance callers only. Native
 * product UI must use archiveClient(); the database also rejects deleting a
 * client that owns operational or legal history. */

export async function deleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const existing = await readCachedClient(id, tenantId);
  const deleteOp = {
    table: "clients" as const,
    op: "delete" as const,
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  };

  if (isOnline()) {
    await cacheDelete("clients", id); // optimistic (standalone online)
    try {
      await repoDeleteClient(supabase, id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      // Fall through to queue — ATOMIC optimistic delete + enqueue (risk
      // #6). The row is already gone from the cache; re-running the delete
      // inside the tx is idempotent and keeps the pair crash-safe.
      await enqueueOpWithCacheDeleteAndEmit(deleteOp, "clients", id);
      void kickReplayer({ supabase });
      return;
    }
  }

  // Offline — ATOMIC optimistic delete + enqueue (risk #6).
  await enqueueOpWithCacheDeleteAndEmit(deleteOp, "clients", id);
}

// ─── Helpers ──────────────────────────────────────────────────────

async function safeCacheReadClients(
  tenantId: string,
): Promise<CachedClientData[]> {
  try {
    const rows = await cacheRead<CachedClientData>("clients", tenantId);
    // An archive op deliberately removes the row from the active cache. This
    // filter is a second wall for legacy/conflict replay rows that may still
    // contain deleted_at in SQLite.
    return rows.filter((row) => row.deleted_at == null);
  } catch {
    return [];
  }
}

async function readCachedClient(
  id: string,
  tenantId?: string,
): Promise<CachedClientData | null> {
  try {
    // Tenant-scope the single-row read to the active tenant (minor: keeps
    // the LWW snapshot from a shared multi-tenant cache picking up a row
    // belonging to another of the user's tenants on an id collision).
    return await cacheGetOne<CachedClientData>("clients", id, tenantId);
  } catch {
    return null;
  }
}

/** After a successful server write, refresh the cache with the CANONICAL
 *  domain row: `repoGetClient` re-reads the row + its junction assignments
 *  (so tag_ids are correct) and we pair it with the server's updated_at for
 *  the denorm column + LWW sentinel. */
async function refetchAndCacheOne(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
): Promise<void> {
  const [client, meta] = await Promise.all([
    repoGetClient(supabase, id, tenantId).catch(() => null),
    supabase
      .from("clients")
      .select("updated_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (!client) return;
  const updatedAt =
    (meta.data?.updated_at as string | undefined) ?? new Date().toISOString();
  await cacheUpsert("clients", makeCachedRow(client, tenantId, updatedAt));
}

function makeServerRow(
  input: Client,
  tenantId: string,
  id: string,
  nowIso: string,
): CachedClient {
  // RAW DB-column projection for the queue payload the replayer INSERTs.
  // Fill required Row columns with safe defaults matching the DB schema;
  // NO tag_ids here (that's a junction table, written online by the repo).
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
    // Колонка в базе осталась (данные не трогаем), но продукт язык клиента
    // больше не ведёт: владелец 2026-07-27 убрал поле — переводы уедут в
    // SMS-рассылки. Для NOT NULL-строки шлём пустую.
    language: "",
    property_type: input.property_type ?? "",
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
  if (patch.city_manual !== undefined) out.city_manual = patch.city_manual;
  if (patch.property_type !== undefined) out.property_type = patch.property_type;
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
