// Client archive / trash, restore and the maintenance-only physical delete.

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
  deleteClient as repoDeleteClient,
  softDeleteClient as repoSoftDeleteClient,
  restoreClient as repoRestoreClient,
} from "../../db/repositories/clients";
import type { Client } from "../../local/clients";
import { cacheUpsert, cacheDelete } from "../../db/cache/sql";
import { isOnline } from "../network";
import { kickReplayer } from "../replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
} from "../queue-events";
import { isTransientNetworkError } from "../transient-error";
import { readCachedClient, refetchAndCacheOne } from "./read";
import { makeCachedRow } from "./rows";
import {
  mustQueueBehind,
  refuseOfflineWrite,
  refuseQueueing,
  type CachedWriteOptions,
} from "./policy";

type DbSupabase = SupabaseClient<Database>;

// ─── Write — delete ───────────────────────────────────────────────

/** Убрать клиента из работы, сохранив заявки, инвойсы и деньги. Без даты
 *  стирания это АРХИВ (бессрочно), с датой — КОРЗИНА «Недавно удалённые».
 *  Очередь несёт UPDATE deleted_at — никогда DELETE.
 *
 *  СТРОКА ОСТАЁТСЯ В КЭШЕ С ПОМЕТКОЙ, а не удаляется из него. `cacheDelete`
 *  сделал бы клиента невидимым ВЕЗДЕ, когда запись уходит в очередь: из
 *  рабочего списка его уже убрали, а экран архива читает напрямую с сервера,
 *  где он ещё числится живым. Оба экрана читают один и тот же кэш, и клиент
 *  всегда где-то виден. */
export async function archiveClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
  /** Когда стереть навсегда. null — архив без срока. */
  purgeAt: string | null = null,
  opts?: CachedWriteOptions,
): Promise<void> {
  assertWritesAllowed("archiveClient");
  refuseOfflineWrite(opts);
  const existing = await readCachedClient(id, tenantId);
  const archivedAt = new Date().toISOString();
  // updated_at НЕ трогаем: это сторожок LWW, он принадлежит серверу. Своя
  // дата здесь заставила бы следующую операцию сравниться с выдуманным
  // значением и решить, что запись устарела.
  const hidden = existing
    ? { ...existing, deleted_at: archivedAt, purge_at: purgeAt }
    : null;
  const archiveOp = {
    table: "clients" as const,
    op: "update" as const,
    row_id: id,
    payload: { deleted_at: archivedAt, purge_at: purgeAt, tenant_id: tenantId },
    expected_updated_at: existing?.updated_at ?? null,
  };
  const queue = () =>
    hidden
      ? enqueueOpWithCacheUpsertAndEmit(archiveOp, "clients", hidden)
      : enqueueOpAndEmit(archiveOp);

  if (isOnline() && !(await mustQueueBehind(id, opts))) {
    if (hidden) await cacheUpsert("clients", hidden);
    try {
      await repoSoftDeleteClient(supabase, id, tenantId, purgeAt);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err) || refuseQueueing(opts)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      await queue();
      void kickReplayer({ supabase });
      return;
    }
  }

  await queue();
  if (isOnline()) void kickReplayer({ supabase });
}

/** Restore an archived client into the active-list cache. Supplying the
 * archived domain row makes the offline result immediately reachable while
 * the queued UPDATE waits for connectivity. */
export async function restoreClient(
  supabase: DbSupabase,
  client: Client,
  tenantId: string,
  opts?: CachedWriteOptions,
): Promise<void> {
  assertWritesAllowed("restoreClient");
  refuseOfflineWrite(opts);
  // Строка, какой она была до возврата: отказ сервера кладёт её обратно.
  const before = await readCachedClient(client.id, tenantId);
  // updated_at НЕ трогаем — как у архива: это сторожок LWW, он принадлежит
  // серверу. Своё время телефона в кэше при `expected_updated_at: null`
  // оставалось версией строки, которой на сервере нет (триггер ставит своё
  // `now()`), и следующая офлайн-правка клиента ловила ложный «конфликт».
  // С прежней версией сторожа реплеер сам переносит свежую на следующие
  // правки строки и в кэш (`carrySentinel`). Строки в кэше нет — версии не
  // знаем, остаётся безусловный возврат.
  const expectedUpdatedAt = before?.updated_at ?? null;
  // Возврат снимает ОБА признака невидимости разом: клиент из корзины
  // возвращается в работу, а не в архив «на полпути».
  const cachedRow = makeCachedRow(
    { ...client, deleted_at: null, purge_at: null },
    tenantId,
    expectedUpdatedAt ?? undefined,
  );
  const restoreOp = {
    table: "clients" as const,
    op: "update" as const,
    row_id: client.id,
    payload: { deleted_at: null, purge_at: null, tenant_id: tenantId },
    expected_updated_at: expectedUpdatedAt,
  };

  if (isOnline() && !(await mustQueueBehind(client.id, opts))) {
    await cacheUpsert("clients", cachedRow);
    try {
      await repoRestoreClient(supabase, client.id, tenantId);
      await refetchAndCacheOne(supabase, client.id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err) || refuseQueueing(opts)) {
        // ОТКАЗ — НЕ «КЛИЕНТА НЕТ». Если удалить строку из кэша,
        // отвергнутый возврат (номер уже занят другим клиентом) унесёт клиента
        // и из «Удалённых» до следующего чтения. Поэтому она возвращается
        // такой, какой была.
        if (before) await cacheUpsert("clients", before).catch(() => {});
        else await cacheDelete("clients", client.id).catch(() => {});
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
  if (isOnline()) void kickReplayer({ supabase });
}

/** Low-level physical delete retained for maintenance callers only. Native
 * product UI must use archiveClient(); the database also rejects deleting a
 * client that owns operational or legal history. */

export async function deleteClient(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
  opts?: CachedWriteOptions,
): Promise<void> {
  assertWritesAllowed("deleteClient");
  refuseOfflineWrite(opts);
  const existing = await readCachedClient(id, tenantId);
  const deleteOp = {
    table: "clients" as const,
    op: "delete" as const,
    row_id: id,
    payload: { id, tenant_id: tenantId },
    expected_updated_at: null,
  };

  if (isOnline() && !(await mustQueueBehind(id, opts))) {
    await cacheDelete("clients", id); // optimistic (standalone online)
    try {
      await repoDeleteClient(supabase, id, tenantId);
      return;
    } catch (err) {
      if (!isTransientNetworkError(err) || refuseQueueing(opts)) {
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

  // Offline (or behind queued edits) — ATOMIC optimistic delete + enqueue.
  await enqueueOpWithCacheDeleteAndEmit(deleteOp, "clients", id);
  if (isOnline()) void kickReplayer({ supabase });
}
