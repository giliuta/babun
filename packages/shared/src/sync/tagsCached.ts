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
//
// The implementation lives in ./tagsCached/: read (list, refresh, cache
// helpers), write (create, update, delete) and rows (row builders).

export { listClientTags } from "./tagsCached/read";
export {
  createClientTag,
  updateClientTag,
  deleteClientTag,
} from "./tagsCached/write";
