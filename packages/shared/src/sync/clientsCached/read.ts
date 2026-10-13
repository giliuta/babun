// Client reads: SWR list, authoritative cache refresh, hidden (archive /
// trash) lists and single-row cache helpers.

import { sameJson } from "../same-json";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db/database.types";
import {
  listClientsWithStamps as repoListClientsWithStamps,
  getClient as repoGetClient,
} from "../../db/repositories/clients";
import type { Client } from "../../local/clients";
import {
  cacheRead,
  cacheUpsert,
  cacheReplaceTenant,
  cacheGetOne,
  hasAuthoritativeTenantSnapshot,
  dequeueAll,
  cacheLocalWriteSeq,
  type CachedClientData,
} from "../../db/cache/sql";
import { isOnline } from "../network";
import { kickReplayer, tenantRefreshHeld } from "../replayer";
import { createRevalidator } from "../revalidator";
import { ColdOfflineCacheMissError } from "../cache-errors";
import { makeCachedRow, rowToClient } from "./rows";

type DbSupabase = SupabaseClient<Database>;

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
    // Тянем ВСЕХ (со скрытыми) — этим наполняется кэш, из которого потом
    // живут и архив, и корзина. Наверх отдаём только рабочий список.
    // Счётчик — ДО запроса: правка, легшая в кэш, пока список ехал, старше
    // снимка не бывает (`cacheLocalWriteSeq`, как у записей).
    const writeSeq = cacheLocalWriteSeq("clients");
    const fetched = await repoListClientsWithStamps(supabase, tenantId, {
      includeDeleted: true,
    });
    await refreshCacheFromSupabase(supabase, tenantId, fetched, writeSeq).catch(() => {});
    return fetched.clients.filter((c) => c.deleted_at == null);
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

const clientsRevalidator = createRevalidator<DbSupabase>("clients", (sb, tenantId) =>
  refreshCacheFromSupabase(sb, tenantId),
);
const revalidateClients = clientsRevalidator.revalidate;

/** Кэш уже совпадает с сервером строка в строку? Сравнение — полным JSON,
 *  а не подписью `id@updated_at`: смена тегов клиента `updated_at` не
 *  двигает, и по подписи такая правка с другого телефона не доезжала до
 *  экрана. Порядок строк не важен; сомнение — в сторону записи. */
function sameClientRows(
  cached: readonly CachedClientData[],
  fresh: readonly CachedClientData[],
): boolean {
  if (cached.length !== fresh.length || fresh.length === 0) return false;
  const byId = new Map(cached.map((r) => [r.id, r]));
  for (const row of fresh) {
    const old = byId.get(row.id);
    if (!old || !sameJson(old, row)) return false;
  }
  return true;
}

/** Refill the cache with the canonical DOMAIN list (tag_ids + nested
 *  fields intact), decorated with the bookkeeping keys the cache layer
 *  needs (tenant_id for scoping, updated_at for the LWW sentinel).
 *
 *  Callers on the cold path pass the already-fetched list to avoid a
 *  second round-trip.
 *
 *  ПРАВКА, ЛЕГШАЯ ЗА ВРЕМЯ ЗАПРОСА, НЕ ЗАТИРАЕТСЯ (аудит 04.10; у записей —
 *  eb6ffe65). Снимок едет секунды; заведённый за это время клиент пропадал,
 *  новый номер откатывался, и следующая правка из очереди несла старый
 *  `updated_at` — ложный «Конфликт» и силовая запись, а правка массива
 *  (заметки, номера) строилась от откатившегося массива и затирала первую.
 *  Теперь замена отменяется, если с начала запроса в кэш клиентов писали, и
 *  следом идёт вторая сверка.
 *
 *  Slice 5 — AUTHORITATIVE + REVALIDATE-BRIDGE. Uses `cacheReplaceTenant`
 *  (delete-then-fill) so a client deleted on another device is pruned from
 *  the cache, not left as a phantom row. Returns whether the cache changed —
 *  the SWR caller emits `revalidated` only on a real change (loop guard). */
async function refreshCacheFromSupabase(
  supabase: DbSupabase,
  tenantId: string,
  fetched?: { clients: Client[]; updatedAtById: Map<string, string> },
  /** Счётчик локальных записей, снятый до запроса `fetched` (холодный путь). */
  writeSeqAtFetch?: number,
): Promise<boolean> {
  const writeSeq = writeSeqAtFetch ?? cacheLocalWriteSeq("clients");
  // Never let an authoritative snapshot erase an optimistic client while its
  // offline mutation is still waiting in the replay queue. Permanently failed
  // ops stop blocking after MAX_ATTEMPTS, allowing the next server snapshot
  // to heal a rejected optimistic row.
  const pending = await dequeueAll();
  if (
    tenantRefreshHeld(pending, "clients", tenantId)
  ) {
    void kickReplayer({ supabase });
    return false;
  }
  // ВКЛЮЧАЯ СКРЫТЫХ. Кэш зеркалит сервер целиком — активные, архивные и
  // лежащие в корзине; каждый экран фильтрует своё. Без этого обновление
  // (cacheReplaceTenant = снести и залить) вычищало бы архив из кэша при
  // первом же ответе сервера, и экран архива снова остался бы без данных.
  // Штамп `updated_at` — из тех же строк, что и данные (см. репозиторий).
  const { clients, updatedAtById } =
    fetched ??
    (await repoListClientsWithStamps(supabase, tenantId, { includeDeleted: true }));
  const rows = clients.map((c) =>
    makeCachedRow(c, tenantId, updatedAtById.get(c.id)),
  );
  // Читаем нефильтрованно — иначе слева активные, справа все, и сверка не
  // совпала бы никогда («revalidated» уходил бы на каждый проход).
  const cachedRows = await allCachedClients(tenantId);
  // КЛИЕНТ, НЕ ДОШЕДШИЙ ДО СЕРВЕРА, С ЭКРАНА НЕ ПРОПАДАЕТ (аудит 04.10; у
  // записей — то же правило). Его вставка, отклонённая навсегда («номер уже
  // заведён», конец пробного), перечитку не держит, и замена кэша снимком
  // сервера стирала клиента: его запись оставалась на сетке без клиента.
  // Пока вставка лежит в очереди («Синхронизация» — повторить или удалить),
  // клиент остаётся.
  const serverIds = new Set(rows.map((r) => r.id));
  const unsentIds = new Set(
    pending
      .filter(
        (op) =>
          op.table === "clients" &&
          op.op === "insert" &&
          (op.payload as { tenant_id?: unknown } | null)?.tenant_id === tenantId,
      )
      .map((op) => op.row_id),
  );
  for (const cached of cachedRows) {
    if (unsentIds.has(cached.id) && !serverIds.has(cached.id)) rows.push(cached);
  }
  if (sameClientRows(cachedRows, rows)) return false;
  const replaced = await cacheReplaceTenant("clients", tenantId, rows, {
    unlessLocalWriteSince: writeSeq,
  });
  if (!replaced) {
    clientsRevalidator.markStale(tenantId);
    return false;
  }
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** ВСЕ строки тенанта из кэша — активные, архивные и лежащие в корзине.
 *  Кэш зеркалит сервер; кто что показывает, решают читатели ниже. */
async function allCachedClients(
  tenantId: string,
): Promise<CachedClientData[]> {
  try {
    return await cacheRead<CachedClientData>("clients", tenantId);
  } catch {
    return [];
  }
}

/** Рабочий список: всё, что не убрано с глаз. */
async function safeCacheReadClients(
  tenantId: string,
): Promise<CachedClientData[]> {
  const rows = await allCachedClients(tenantId);
  return rows.filter((row) => row.deleted_at == null);
}

/** Скрытые клиенты: архив (`trashed=false`) или корзина (`trashed=true`).
 *
 *  Читается ИЗ КЭША, а не с сервера. Так экран архива видит и то, что ещё
 *  не доехало до сервера: архивация в дороге кладёт клиента в кэш с
 *  пометкой, и он сразу находится там, где его ищут. Сортировка разная,
 *  потому что вопрос разный: в архиве важно «кого убрали последним», в
 *  корзине — «кого сотрут первым». */
async function listHiddenClients(
  supabase: DbSupabase,
  tenantId: string,
  trashed: boolean,
): Promise<Client[]> {
  let rows = await allCachedClients(tenantId);
  if (rows.length === 0) {
    // Холодный кэш: пустой архив — это «не знаю», а не «пусто». Ждём ответа
    // сервера, иначе экран соврёт, что архив чист.
    await refreshCacheFromSupabase(supabase, tenantId).catch(() => {});
    rows = await allCachedClients(tenantId);
  } else {
    void revalidateClients(supabase, tenantId);
  }
  return rows
    .filter((r) => r.deleted_at != null && (r.purge_at != null) === trashed)
    .sort((a, b) =>
      trashed
        ? (a.purge_at ?? "").localeCompare(b.purge_at ?? "")
        : (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""),
    )
    .map(rowToClient);
}

/** Архив: убраны из работы бессрочно, срока стирания нет. */
export function listArchivedClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Client[]> {
  return listHiddenClients(supabase, tenantId, false);
}

/** Корзина «Недавно удалённые»: сотрутся в свой purge_at. */
export function listTrashedClients(
  supabase: DbSupabase,
  tenantId: string,
): Promise<Client[]> {
  return listHiddenClients(supabase, tenantId, true);
}

export async function readCachedClient(
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
export async function refetchAndCacheOne(
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
