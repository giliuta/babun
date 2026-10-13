// STORY-062 slice 3 — shared offline-aware appointment repository wrappers.
//
// Port of apps/web/src/lib/sync/appointmentsCached.ts. Backend-neutral
// changes only (same as clientsCached.ts):
//   1. SQLite cache (`../db/cache/sql`); `readCachedAppointment` uses
//      `cacheGetOne` instead of the web `(await getCache()).get(...)`.
//   2. Web-only quota module stays out of this host-neutral wrapper. Mobile
//      preflights interactive creates in its hook and injects the policy into
//      the replayer for offline writes.
//   3. `crypto.randomUUID()` → `randomUuid()` (RN-safe).
//
// Original behaviour preserved verbatim, including the v452 UUID guard: a
// non-uuid id (legacy `apt-${ts}-rnd` from generateId("apt")) never reached
// Supabase, so update/delete on it skip the network + queue entirely (the
// optimistic cache write is the full story).
//
// Slice 5 — cache-of-DOMAIN. The cache `data` column stores the FULL
// `Appointment` domain object (the same shape `repoListAppointments`
// returns) decorated with `tenant_id` (the only bookkeeping key the domain
// shape lacks — it already carries `date` + `updated_at`). `rowToAppointment`
// returns it whole, so an online read-from-cache is byte-identical to a live
// repo read.
//
// TWO PROJECTIONS (rule 4). The queue payload is the RAW DB-column
// projection the server accepts (built by `makeServerRow` / `patchToRow`);
// the cache `data` is the full domain object (built by `makeCachedRow` /
// domain merge). dispatch relays `payload` to PostgREST; reads parse `data`.
//
// PHOTOS — the appointments row dropped its `photos` column (STORY-049);
// list/get never carry blobs (they live in appointment_photos + Storage).
// So the domain `Appointment` from the repo already has `photos: []`, and
// the cache stores that — nothing to preserve here. The photo viewer
// fetches blobs on demand (online-only), matching web + the repo contract.
//
// The implementation lives in ./appointmentsCached/: read (list, refresh,
// cache helpers), write (create, update, delete) and rows (cache and queue
// row builders).

export { listAppointments, cacheServerAppointment } from "./appointmentsCached/read";
export {
  createAppointment,
  updateAppointment,
  deleteAppointment,
  PAID_CANCEL_OFFLINE,
  cancelsPaidVisit,
} from "./appointmentsCached/write";
