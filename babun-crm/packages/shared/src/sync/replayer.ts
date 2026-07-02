// STORY-062 slice 3 — shared sync-queue replayer.
//
// Port of apps/web/src/lib/sync/replayer.ts. The web original imported the
// IndexedDB cache + a web-only quota gate (`@/lib/quota/check`). This shared
// version:
//   1. Reads the queue/cache from the SQLite cache (`../db/cache/sql`) —
//      identical public surface, so the drain/dispatch logic is byte-for-byte.
//   2. Takes the quota gate as an OPTIONAL injection
//      (`ReplayerOptions.quota`). If absent it is a no-op — mobile passes a
//      no-op (lib/quota.ts), the web app (which keeps its own replayer copy)
//      is untouched. `assertAvailable(op)` throwing a `QuotaExceeded`-shaped
//      error (has `.quota === true`) is treated as KNOWN-PERMANENT exactly
//      like the web `QuotaExceededError` branch.
//   3. Otherwise preserves ALL data-loss guards verbatim:
//        • single-flight (draining + pendingFollowup, at-most-one follow-up)
//        • backoff [1000, 5000, 30000] ms, MAX_ATTEMPTS = 3
//        • UUID-guard — non-uuid row_id on update/delete → perm-fail
//        • insert idempotency — 23505 / «duplicate key» → success; strip a
//          non-uuid `id` from the payload + cacheDelete the local orphan
//        • LWW UPDATE — force-update path uses `.maybeSingle()` (NOT
//          `.single()`, which throws PGRST116 and wedges the whole queue)
//        • tableForOp — `tags` → `client_tags`
//
// Drain triggers on RN come through onlineManager (NetInfo) wired in
// lib/sync-runtime.ts — the equivalent of the web `online` listener /
// onResync callback. The web header's Service-Worker Background-Sync note
// does not apply on native.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/database.types";
import {
  dequeueAll,
  cacheUpsert,
  cacheDelete,
  type QueuedOp,
  type CachedTable,
} from "../db/cache/sql";
// Go through the emit-wrappers so the OfflineIndicator badge updates the
// moment the replayer succeeds/fails an op, instead of waiting for the 5-s
// safety poll.
import {
  removeOpAndEmit as removeOp,
  bumpAttemptAndEmit as bumpAttempt,
  markOpPermanentlyFailedAndEmit,
} from "./queue-events";

// ─── Injectable quota gate ────────────────────────────────────────────
// The web replayer imported `assertQuotaAvailable` + `QuotaExceededError`
// from `@/lib/quota/check`. That module is web-only (server-count RPC). The
// shared replayer accepts an optional gate instead:
//   • `assertAvailable(op)` — throw to block the insert. A throw carrying a
//     truthy `.quota` (a QuotaExceeded-shaped error) is treated as
//     KNOWN-PERMANENT (mark perm-failed immediately, no retry windows);
//     any other throw falls through to the normal dispatch + bump path so a
//     transient blip doesn't permanently fail the op.
// Mobile injects a no-op (lib/quota.ts). Web is unaffected (keeps its copy).
export interface QuotaGate {
  /** Called before an offline INSERT replays. Throw to block; a throw with
   *  `.quota === true` (+ optional `.message`) is a permanent quota breach. */
  assertAvailable(op: QueuedOp): void | Promise<void>;
}

function isQuotaError(err: unknown): err is { quota: true; message?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { quota?: unknown }).quota === true
  );
}

// v452 — every cached table targets a Supabase relation whose `id`
// column is uuid. Ops carrying a non-uuid `row_id` are local orphans
// (insert never succeeded server-side — typically because the row
// included a column the migration hadn't reached yet). Replaying
// them spends three retry windows on guaranteed-failure ops and
// surfaces an unactionable error in SyncQueuePanel. Detect them up
// front and mark them permanently failed so the user can drop them
// from the panel.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string): boolean => UUID_RE.test(s);

type DbSupabase = SupabaseClient<Database>;

const MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [1000, 5000, 30000]; // attempts 1, 2, 3

type Toast = (msg: string) => void;

interface ReplayerOptions {
  supabase: DbSupabase;
  /** OPTIONAL active tenant id (offline-plan risk #1, second half). When
   *  supplied, an op whose `payload.tenant_id` is present and DIFFERENT is
   *  skipped — never drained under this session — so a queue entry left by a
   *  previous tenant (a cacheClearAll wipe that was missed on the tenant
   *  switch) can't replay onto the server under the current tenant's auth.
   *  Absent = no tenant gating (the current sync-runtime doesn't pass it;
   *  behaviour is then identical to before). Skipped ops stay in the queue
   *  rather than being discarded — the wipe on the next clean switch removes
   *  them. */
  tenantId?: string;
  /** OPTIONAL quota gate — see QuotaGate. Absent = no gating (mobile passes
   *  a no-op; behaviour with no gate matches "quota always available"). */
  quota?: QuotaGate;
  /** Called after the drain completes (success or error) so the UI
   *  can refresh its in-memory state from the cache + Supabase. */
  onChanged?: () => void;
  /** Called on conflict detection (0 rows affected). UI surfaces:
   *  «Запись была обновлена на другом устройстве. Применены ваши
   *  изменения.» */
  onConflict?: Toast;
  /** Called when an op fails MAX_ATTEMPTS times. UI surfaces a
   *  retry-able warning in the sidebar / SyncQueuePanel. */
  onPermanentFailure?: (op: QueuedOp) => void;
}

let draining = false;
let pendingFollowup = false;

/** Public trigger — call from `online` listener, onResync, manual
 *  retry button, or after a write failed mid-flight. Idempotent
 *  and self-coalescing. */
export async function kickReplayer(opts: ReplayerOptions): Promise<void> {
  if (draining) {
    pendingFollowup = true;
    return;
  }
  draining = true;
  try {
    await drain(opts);
    if (pendingFollowup) {
      pendingFollowup = false;
      // Run one follow-up pass synchronously so coalesced triggers
      // get a chance to flush the queue without recursion explosion.
      await drain(opts);
    }
  } finally {
    draining = false;
  }
}

async function drain(opts: ReplayerOptions): Promise<void> {
  const ops = await dequeueAll(); // sorted by created_at ASC via index
  if (ops.length === 0) return;

  for (const op of ops) {
    if (op.attempts >= MAX_ATTEMPTS) {
      // Already failed permanently — leave in queue so the UI can
      // show the manual-retry button. Manual retry resets attempts.
      continue;
    }

    // offline-plan risk #1 (second half) — tenant gate. If an active
    // tenant is supplied and this op belongs to a DIFFERENT tenant, do
    // NOT drain it under the current session (it would replay onto the
    // server with the wrong tenant's auth). Leave it in the queue — the
    // cacheClearAll wipe on a clean tenant switch is what removes it. No
    // gate (tenantId unset) → skip this check entirely (behaviour as
    // before). We read the tenant off the payload the wrapper enqueued.
    if (opts.tenantId) {
      const payloadTenant = (op.payload as { tenant_id?: unknown })?.tenant_id;
      if (
        typeof payloadTenant === "string" &&
        payloadTenant !== opts.tenantId
      ) {
        continue;
      }
    }

    // v452 — fail-fast for non-UUID row_ids targeting uuid id
    // columns. These are unrecoverable: the row was never accepted
    // by Postgres in the first place, and replaying any op against
    // a synthetic local id (`apt-...`) returns the same 22P02
    // «invalid input syntax for type uuid» error. Mark perm-failed
    // immediately so the SyncQueuePanel's «Удалить» button is the
    // only action shown.
    if ((op.op === "delete" || op.op === "update") && !isUuid(op.row_id)) {
      const msg = `non-uuid row_id: "${op.row_id}" — local orphan, cannot replay`;
      await markOpPermanentlyFailedAndEmit(op.id, msg);
      opts.onPermanentFailure?.({
        ...op,
        attempts: MAX_ATTEMPTS,
        last_error: msg,
      });
      continue;
    }

    // Soft-throttle: if this op was recently attempted, wait its
    // backoff. We measure attempts->backoff naively; the queue
    // doesn't carry last_attempt_at to keep the schema small.
    if (op.attempts > 0) {
      const backoff = BACKOFFS_MS[Math.min(op.attempts - 1, BACKOFFS_MS.length - 1)] ?? 30000;
      await sleep(backoff);
    }

    // STORY-052 G4 — pre-gate offline INSERTs on the tier quota (when a
    // gate is injected). Quota failures are KNOWN-PERMANENT (waiting +
    // retrying won't free up tier headroom), so mark perm-failed
    // immediately instead of burning 3 retry windows. UI shows the row in
    // SyncQueuePanel with last_error so the user knows why + can upgrade
    // and manually retry from the panel. No gate → skip entirely.
    if (op.op === "insert" && opts.quota) {
      try {
        await opts.quota.assertAvailable(op);
      } catch (err) {
        if (isQuotaError(err)) {
          const msg = err.message || "Quota exceeded";
          await markOpPermanentlyFailedAndEmit(op.id, msg);
          opts.onPermanentFailure?.({
            ...op,
            attempts: 999,
            last_error: msg,
          });
          continue;
        }
        // Non-quota error in the gate — fall through to normal
        // dispatch + bump-attempt path so a transient blip doesn't
        // permanently fail the op.
      }
    }

    try {
      const conflict = await dispatch(opts.supabase, op);
      if (conflict) {
        opts.onConflict?.(
          "Запись была обновлена на другом устройстве. Применены ваши изменения.",
        );
      }
      await removeOp(op.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bumpAttempt(op.id, msg);
      // If we just exceeded the cap, surface to UI once.
      if (op.attempts + 1 >= MAX_ATTEMPTS) {
        opts.onPermanentFailure?.({
          ...op,
          attempts: op.attempts + 1,
          last_error: msg,
        });
      }
      // Don't bail the entire drain on one failure — keep going so
      // ops behind a poisoned one still get their chance.
    }
  }

  opts.onChanged?.();
}

/** Returns `true` if the dispatch succeeded but a conflict was
 *  detected (UPDATE matched 0 rows on the first pass; we then
 *  retried without expected_updated_at and that one succeeded).
 *  Throws on unrecoverable errors so the caller bumps attempts. */
async function dispatch(
  supabase: DbSupabase,
  op: QueuedOp,
): Promise<boolean> {
  // The repositories accept the row shapes already; payloads are
  // pre-shaped at enqueue time so dispatch is mostly a relay. We
  // talk directly to PostgREST here (not through the typed repo
  // helpers) because:
  //   1. Each table has a different repo function signature; a
  //      generic relay keeps the replayer table-agnostic.
  //   2. The conflict-detection pattern (UPDATE WHERE updated_at)
  //      is uniform across tables.
  const tableName = tableForOp(op.table);

  if (op.op === "delete") {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .eq("id", op.row_id);
    if (error) throw new Error(`replay delete: ${error.message}`);
    return false;
  }

  if (op.op === "insert") {
    // v489 — defensive: pre-v489 queued inserts may carry a non-UUID
    // `id` (`apt-mp2we5l1-...`) inside the payload. Supabase's id
    // columns are uuid → INSERT 22P02 «invalid input syntax for type
    // uuid», stranding the row. Strip the id so the server allocates
    // a fresh UUID, then drop the local-id row from IDB cache so
    // the orphan optimistic row doesn't double up next list().
    let payload = op.payload as Record<string, unknown>;
    let stripped = false;
    if (!isUuid(op.row_id) && typeof payload === "object" && payload !== null) {
      const { id: _id, ...rest } = payload as { id?: string };
      void _id;
      payload = rest;
      stripped = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from(tableName).insert(payload as any);
    if (error) {
      // v502 — idempotent insert: a duplicate-key error means the row
      // is already on the server (the previous attempt's HTTP response
      // got lost — app closed mid-flight, network blip, etc.). Treat
      // as success so the queue entry drops instead of getting stuck
      // forever retrying the same DOA insert. Without this, the panel
      // showed «replay insert: duplicate key value violates unique
      // constraint "appointments_pkey"» indefinitely after the user's
      // first successful save.
      //
      // PG code 23505 is the canonical signal; we also fall back to a
      // message-match because supabase-js can wrap the error and lose
      // the code in some paths.
      const code = (error as { code?: string }).code;
      const dup =
        code === "23505" || /duplicate key/i.test(error.message);
      if (!dup) throw new Error(`replay insert: ${error.message}`);
    }
    if (stripped) {
      try {
        await cacheDelete(op.table, op.row_id);
      } catch {
        /* ignore — cache may already be gone */
      }
    }
    return false;
  }

  // op.op === 'update' — last-write-wins via updated_at sentinel.
  // Table-agnostic dispatch: cast through `unknown` to a
  // PostgrestFilterBuilder so we can chain `.eq("updated_at", ...)`
  // without per-table type narrowing. The replayer is intentionally
  // generic across cached tables.
  if (op.expected_updated_at) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const filter = (
      supabase.from(tableName).update(op.payload as any) as any
    )
      .eq("id", op.row_id)
      .eq("updated_at", op.expected_updated_at)
      .select("id");
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { data, error } = await filter;
    if (error) throw new Error(`replay update: ${error.message}`);
    if (data && data.length > 0) return false; // matched cleanly

    // 0 rows → conflict. Retry without updated_at filter and re-fetch
    // the canonical server row (now carrying the new updated_at) so
    // the cache stays consistent. Without this re-fetch, IDB would
    // hold the pre-conflict updated_at and falsely conflict on the
    // next edit.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const forceFilter = (
      supabase.from(tableName).update(op.payload as any) as any
    )
      .eq("id", op.row_id)
      .select()
      // maybeSingle, NOT single. When the force-update matches 0 rows —
      // the target was deleted on the server, or RLS hides it from this
      // user (a non-'work' row created by someone else, or a stale
      // tenant JWT) — `.single()` throws PGRST116 «Cannot coerce the
      // result to a single JSON object». That re-threw on every retry,
      // wedging the op at attempt N/N and blocking the ENTIRE queue, so
      // later writes never synced → silent cross-device desync
      // (user-reported). maybeSingle returns { data: null } instead.
      .maybeSingle();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { data: forced, error: forceErr } = await forceFilter;
    if (forceErr)
      throw new Error(`replay force-update: ${forceErr.message}`);
    if (forced) {
      // Cache write-through with the canonical row.
      await cacheUpsert(op.table as CachedTable, forced);
    }
    // forced === null → 0 rows: the update is unappliable (row gone /
    // not writable for this user). DROP the op (return true) instead of
    // looping forever — a permanently-stuck op blocks the whole queue.
    // The local cache self-heals on the next full refetch (foreground
    // revalidate / realtime onResync re-pulls the canonical rows).
    return true;
  }

  // No expected_updated_at — unconditional update (e.g. queued from
  // a context where we didn't have the cached row yet).
  const { error: plainErr } = await supabase
    .from(tableName)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(op.payload as any)
    .eq("id", op.row_id);
  if (plainErr) throw new Error(`replay update (plain): ${plainErr.message}`);
  return false;
}

function tableForOp(t: QueuedOp["table"]): "clients" | "appointments" | "client_tags" {
  // UI vocab → DB table. See cache layer header for rationale.
  return t === "tags" ? "client_tags" : t;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
