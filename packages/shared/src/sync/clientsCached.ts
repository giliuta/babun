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
// pulls the canonical domain list via `repoListClientsWithStamps` (which
// joins the junction) so background refresh keeps `tag_ids` accurate too.
//
// TWO PROJECTIONS (offline-plan rule 4). What lands in the queue payload is
// the RAW DB-column projection the server accepts (built by `makeServerRow`
// / `clientToUpdate` — NO `tag_ids`, nested arrays as jsonb). What lands in the
// cache `data` is the full domain object (built by `makeCachedRow` /
// `mergeCachedRow`). The two never mix: dispatch relays `payload` straight
// to PostgREST; reads parse `data`.
//
// ВЕБ. Эти обёртки работают и в браузере, где SQLite нет. Раньше первый же
// cacheUpsert падал на «No SqlAdapter configured» ДО обращения к серверу — и
// ни один клиент из браузера не сохранялся, молча. Теперь getSql() отдаёт там
// NoCacheSqlAdapter (storage/sql/no-cache.ts): кэш всегда пуст, зеркальные
// записи уходят в никуда (копию сервера потерять не страшно), а вот ОФЛАЙН-
// ВЕТКА — та, что ниже зовёт enqueueOp* — отказывает громко. Так и должно
// быть: реплеер на вебе не смонтирован, «сохраню позже» там не наступит.
//
// v1 limitation — `tag_ids` patch is ONLINE-ONLY: the junction write path
// lives in the repo (online) and the replayer can't diff assignments, so
// offline + patch carrying tag_ids → strip + toast.
//
// The implementation lives in ./clientsCached/: read (list, refresh, hidden
// lists), write (create, update), archive (archive, restore, delete), rows
// (cache and queue row builders) and policy (toast, online-only writes).

export { setSyncToast, type CachedWriteOptions } from "./clientsCached/policy";
export {
  listClients,
  listArchivedClients,
  listTrashedClients,
} from "./clientsCached/read";
export { createClient, updateClient } from "./clientsCached/write";
export { archiveClient, restoreClient, deleteClient } from "./clientsCached/archive";
export { makeServerRow } from "./clientsCached/rows";
