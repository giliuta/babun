// Client create and update: optimistic cache row, online write, and the
// queue on the offline / network-blip path.

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
  createClient as repoCreateClient,
  updateClient as repoUpdateClient,
  clientToUpdate,
} from "../../db/repositories/clients";
import type { Client } from "../../local/clients";
import { cacheUpsert, cacheDelete, type CachedClientData } from "../../db/cache/sql";
import { isOnline } from "../network";
import { kickReplayer } from "../replayer";
import {
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
} from "../queue-events";
import { randomUuid } from "../uuid";
import { isTransientNetworkError } from "../transient-error";
import { OnlineOnlyWriteError } from "../cache-errors";
import { readCachedClient, refetchAndCacheOne } from "./read";
import { makeCachedRow, makeServerRow, toDomain } from "./rows";
import {
  mustQueueBehind,
  refuseOfflineWrite,
  refuseQueueing,
  warnToast,
  type CachedWriteOptions,
} from "./policy";

type DbSupabase = SupabaseClient<Database>;

const TAGS_ONLINE_ONLY = "Изменения тегов недоступны без сети — попробуйте позже";

// МАССИВЫ КЛИЕНТА НЕ ПИШУТСЯ ПОВЕРХ БОЛЕЕ СВЕЖЕЙ СТРОКИ.
//
// Телефоны, объекты, заметки, реквизиты, связи и оборудование — каждый одна
// jsonb-колонка, и правка пишет массив целиком. Если строку уже изменили на
// другом телефоне (или заказчик прислал точку по ссылке), наш массив собран
// из старой версии и стёр бы чужой объект или заметку. Функция правки сервера
// версии не сверяет, поэтому сверяем перед ней: `updated_at` сервера ушёл от
// кэша — не пишем, кэш берёт строку сервера, человек видит свежую. Офлайн-
// правка уступает тем же правилом при сливе (`replayUpdate`).
const ARRAY_FIELDS = [
  "phones",
  "locations",
  "notes",
  "requisites",
  "memberships",
  "equipment",
] as const satisfies readonly (keyof Client)[];

const CLIENT_NEWER_ON_SERVER =
  "Карточку клиента изменили на другом устройстве — показываю свежую версию";

/** Правку массива клиента не применили: строка на сервере свежее кэша. */
export class ClientNewerOnServerError extends Error {
  constructor() {
    super(CLIENT_NEWER_ON_SERVER);
    this.name = "ClientNewerOnServerError";
  }
}

function touchesClientArrays(patch: Partial<Client>): boolean {
  return ARRAY_FIELDS.some((field) => patch[field] !== undefined);
}

async function assertClientNotNewer(
  supabase: DbSupabase,
  id: string,
  tenantId: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("clients")
    .select("updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`updateClient: ${error.message}`);
  if (data && data.updated_at !== expectedUpdatedAt) throw new ClientNewerOnServerError();
}

// ─── Write — create ───────────────────────────────────────────────

export async function createClient(
  supabase: DbSupabase,
  input: Client,
  tenantId: string,
  opts?: CachedWriteOptions,
): Promise<Client> {
  assertWritesAllowed("createClient");
  refuseOfflineWrite(opts);
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
      // Запись в неактивную компанию в очередь не ложится: откат и отказ.
      if (refuseQueueing(opts)) {
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
  opts?: CachedWriteOptions,
): Promise<Client> {
  assertWritesAllowed("updateClient");
  refuseOfflineWrite(opts);
  // Snapshot existing cached row for conflict-detection sentinel.
  const existing = await readCachedClient(id, tenantId);
  const expectedUpdatedAt = existing?.updated_at ?? null;
  const offline = !isOnline();

  // v1 limitation: tag_ids edits are online-only. If offline + patch
  // includes tag_ids → strip + toast.
  let scrubbedPatch = patch;
  if (offline && patch.tag_ids !== undefined) {
    warnToast(TAGS_ONLINE_ONLY);
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
    // Компания — для гейта очереди (`replayer.ts`), на сервер она не уходит.
    payload: { ...clientToUpdate(scrubbedPatch), tenant_id: tenantId } as Record<string, unknown>,
    expected_updated_at: expectedUpdatedAt,
  };

  // Теги в очередь не ложатся (правка тегов только в сети) — такая правка
  // идёт напрямую и при ждущей очереди.
  const queued = !offline && (await mustQueueBehind(id, opts));
  if (!offline && (!queued || scrubbedPatch.tag_ids !== undefined)) {
    // Online: standalone optimistic upsert (no queued op to pair with).
    if (merged) await cacheUpsert("clients", merged);
    try {
      if (expectedUpdatedAt && touchesClientArrays(scrubbedPatch)) {
        await assertClientNotNewer(supabase, id, tenantId, expectedUpdatedAt);
      }
      const updated = await repoUpdateClient(
        supabase,
        id,
        scrubbedPatch,
        tenantId,
      );
      await refetchAndCacheOne(supabase, id, tenantId);
      return updated;
    } catch (err) {
      if (err instanceof ClientNewerOnServerError) {
        await refetchAndCacheOne(supabase, id, tenantId).catch(() => {});
        throw err;
      }
      if (!isTransientNetworkError(err)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      if (refuseQueueing(opts)) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw err;
      }
      // ТЕГИ В ОЧЕРЕДЬ НЕ ЛОЖАТСЯ: связующую таблицу очередь не несёт
      // (`clientToUpdate` про `tag_ids` не знает). Положить правку в очередь и
      // вернуть успех — значит показать новые теги, которые пропадут при
      // первой перечитке. Отказываем всей правке целиком (вместе с прочими
      // полями патча — карточка шлёт теги отдельно), откатив кэш.
      if (scrubbedPatch.tag_ids !== undefined) {
        if (existing) await cacheUpsert("clients", existing).catch(() => {});
        throw new OnlineOnlyWriteError(TAGS_ONLINE_ONLY);
      }
      await enqueueUpdate(updateOp, merged);
      void kickReplayer({ supabase });
      // Optimistic shape — caller sees the merged result; realtime
      // will overwrite once reconnect.
      return { ...toDomain(existing), ...scrubbedPatch, id } as Client;
    }
  }

  // Offline (or behind this client's queued edits) — queue the write (ATOMIC
  // with the optimistic row when we have one; plain enqueue when the row
  // wasn't cached yet).
  await enqueueUpdate(updateOp, merged);
  if (queued) void kickReplayer({ supabase });
  return { ...toDomain(existing), ...scrubbedPatch, id } as Client;
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
