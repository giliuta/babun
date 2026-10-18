// Tag create, update and delete: optimistic cache row, online write, and
// the queue on the offline / network-blip path.

// ЗАСОВ — ПЕРЕД ОПТИМИСТИЧНОЙ СТРОКОЙ, А НЕ ПЕРЕД ОТПРАВКОЙ.
//
// Эти обёртки офлайн-первые: строка ложится в SQLite СРАЗУ, а на сервер
// уезжает после. В режиме просмотра чужими глазами отправку отобьёт засов
// (`write-guard.ts`), но местная копия к тому времени уже записана, и откат
// у неё молчащий — не удался, и в кэше владельца остаётся призрак строки,
// которой на сервере никогда не было. Поэтому спрашиваем до всего.
import { assertWritesAllowed } from "../write-guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import {
  createClientTag as repoCreateClientTag,
  updateClientTag as repoUpdateClientTag,
  deleteClientTag as repoDeleteClientTag,
} from "../../db/repositories/clients";
import type { ClientTag } from "../../local/clients";
import {
  cacheUpsert,
  cacheDelete,
  type CachedTag,
  hasQueuedOps,
} from "../../db/cache/sql";
import { isOnline } from "../network";
import { OnlineOnlyWriteError } from "../cache-errors";
import type { CachedWriteOptions } from "../clientsCached";
import { kickReplayer } from "../replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
} from "../queue-events";
import { randomUuid } from "../uuid";
import { isTransientNetworkError } from "../transient-error";
import { readCachedTag } from "./read";

type DbSupabase = SupabaseClient<Database>;

// ─── Write ────────────────────────────────────────────────────────

export async function createClientTag(
  supabase: DbSupabase,
  input: {
    name: string;
    color: string;
    icon?: string | null;
    position?: number;
    /** Команда тега — обязательна (у каждой команды свои теги). */
    team_id: string;
  },
  tenantId: string,
  opts?: CachedWriteOptions,
): Promise<ClientTag> {
  assertWritesAllowed("createClientTag");
  if (opts?.onlineOnly && !isOnline()) throw new OnlineOnlyWriteError(opts.onlineOnly);
  const id = randomUuid();
  const optimisticRow: CachedTag = {
    id,
    tenant_id: tenantId,
    name: input.name,
    color: input.color,
    icon: input.icon ?? null,
    position: input.position ?? 0,
    hidden: false,
    team_id: input.team_id,
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
      // Keep the same UUID online and in the offline queue. If the HTTP
      // response is lost after commit, replay sees 23505 and treats it as an
      // idempotent success instead of creating a duplicate tag.
      const created = await repoCreateClientTag(
        supabase,
        { ...input, id },
        tenantId,
      );
      await cacheUpsert("tags", {
        id: created.id,
        tenant_id: tenantId,
        name: created.name,
        color: created.color,
        icon: created.icon ?? null,
        position: created.position ?? 0,
        hidden: created.hidden ?? false,
        team_id: created.team_id ?? input.team_id,
      });
      return created;
    } catch (err) {
      if (!isTransientNetworkError(err) || opts?.onlineOnly) {
        await cacheDelete("tags", id).catch(() => {});
        throw err;
      }
      // Network blip — ATOMIC optimistic upsert + enqueue (risk #6).
      await enqueueOpWithCacheUpsertAndEmit(insertOp, "tags", optimisticRow);
      void kickReplayer({ supabase });
      return {
        id,
        name: input.name,
        color: input.color,
        icon: input.icon ?? null,
        position: input.position ?? 0,
        hidden: false,
        team_id: input.team_id,
      };
    }
  }

  // Offline — ATOMIC optimistic upsert + enqueue (risk #6).
  await enqueueOpWithCacheUpsertAndEmit(insertOp, "tags", optimisticRow);
  return {
    id,
    name: input.name,
    color: input.color,
    icon: input.icon ?? null,
    position: input.position ?? 0,
    hidden: false,
    team_id: input.team_id,
  };
}

export async function updateClientTag(
  supabase: DbSupabase,
  id: string,
  patch: {
    name?: string;
    color?: string;
    icon?: string | null;
    position?: number;
    hidden?: boolean;
  },
  tenantId: string,
  opts?: CachedWriteOptions,
): Promise<ClientTag> {
  assertWritesAllowed("updateClientTag");
  if (opts?.onlineOnly && !isOnline()) throw new OnlineOnlyWriteError(opts.onlineOnly);
  const existing = await readCachedTag(id, tenantId);
  const merged: CachedTag | null = existing
    ? { ...existing, ...patch }
    : null;
  const updateOp = {
    table: "tags" as const,
    op: "update" as const,
    row_id: id,
    // Компания — для гейта очереди (`replayer.ts`), на сервер она не уходит.
    payload: { ...patch, tenant_id: tenantId } as Record<string, unknown>,
    expected_updated_at: null, // no updated_at column → no detection
  };

  // ПОРЯДОК ПРАВОК ТЕГА — ПОРЯДОК ЖЕСТОВ. У тега
  // нет `updated_at`, и очередь шлёт его правку без сторожа: правка A→B,
  // упавшая на обрыве в очередь, долетала ПОСЛЕ прошедшей в сети B→C и
  // возвращала B. Есть ждущие правки этого тега — новая встаёт за ними.
  const behindQueued = await hasQueuedOps("tags", id).catch(() => false);
  if (isOnline() && !behindQueued) {
    // Online: standalone optimistic upsert (no queued op to pair with).
    if (merged) await cacheUpsert("tags", merged);
    try {
      const updated = await repoUpdateClientTag(supabase, id, patch, tenantId);
      await cacheUpsert("tags", {
        id: updated.id,
        tenant_id: tenantId,
        name: updated.name,
        color: updated.color,
        icon: updated.icon ?? null,
        position: updated.position ?? 0,
        hidden: updated.hidden ?? false,
        team_id: updated.team_id ?? existing?.team_id ?? "",
      });
      return updated;
    } catch (err) {
      if (!isTransientNetworkError(err) || opts?.onlineOnly) {
        if (existing) await cacheUpsert("tags", existing).catch(() => {});
        throw err;
      }
      await enqueueTagUpdate(updateOp, merged);
      void kickReplayer({ supabase });
      return {
        id,
        name: patch.name ?? existing?.name ?? "",
        color: patch.color ?? existing?.color ?? "",
        icon: patch.icon ?? existing?.icon ?? null,
        position: patch.position ?? existing?.position ?? 0,
        hidden: patch.hidden ?? existing?.hidden ?? false,
      };
    }
  }

  // Offline (или за ждущими правками) — ATOMIC with the optimistic row
  // when cached (risk #6). В сети очередь пинаем сразу.
  await enqueueTagUpdate(updateOp, merged);
  if (isOnline()) void kickReplayer({ supabase });
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
  opts?: CachedWriteOptions,
): Promise<void> {
  assertWritesAllowed("deleteClientTag");
  if (opts?.onlineOnly && !isOnline()) throw new OnlineOnlyWriteError(opts.onlineOnly);
  const existing = await readCachedTag(id, tenantId);
  const deleteOp = {
    table: "tags" as const,
    op: "delete" as const,
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  };

  // Удаление тоже ждёт ждущие правки тега — иначе правка, долетевшая после,
  // искала бы уже удалённую строку.
  const behindQueued = await hasQueuedOps("tags", id).catch(() => false);
  if (isOnline() && !behindQueued) {
    await cacheDelete("tags", id); // optimistic (standalone online)
    try {
      await repoDeleteClientTag(supabase, id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err) || opts?.onlineOnly) {
        if (existing) await cacheUpsert("tags", existing).catch(() => {});
        throw err;
      }
      // Fall through — ATOMIC optimistic delete + enqueue (risk #6).
      await enqueueOpWithCacheDeleteAndEmit(deleteOp, "tags", id);
      void kickReplayer({ supabase });
      return;
    }
  }

  // Offline (или за ждущими правками) — ATOMIC optimistic delete + enqueue
  // (risk #6). В сети очередь пинаем сразу.
  await enqueueOpWithCacheDeleteAndEmit(deleteOp, "tags", id);
  if (isOnline()) void kickReplayer({ supabase });
}
