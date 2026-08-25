// STORY-062 slice 3 — shared sync-queue replayer.
//
// Port of apps/web/src/lib/sync/replayer.ts. The web original imported the
// IndexedDB cache + a web-only quota gate (`@/lib/quota/check`). This shared
// version:
//   1. Reads the queue/cache from the SQLite cache (`../db/cache/sql`) —
//      identical public surface, so the drain/dispatch logic is byte-for-byte.
//   2. Takes the quota gate as an OPTIONAL injection
//      (`ReplayerOptions.quota`). The mobile host installs a live server-backed
//      gate as a process default; other hosts may omit it. `assertAvailable(op)`
//      throwing a `QuotaExceeded`-shaped
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
import type { Database, Json } from "../db/database.types";
import {
  dequeueAll,
  cacheGetOne,
  cacheUpsert,
  cacheDelete,
  type QueuedOp,
  type CachedTable,
  type CachedClient,
  type CachedClientData,
  type CachedTag,
  type CachedAppointmentData,
} from "../db/cache/sql";
import { rowToAppointment } from "../db/repositories/appointments";
import { rowToClient } from "../db/repositories/clients";
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
// Mobile injects its server-backed gate from lib/quota-gate.ts. Web is
// unaffected (it keeps its own replayer copy).
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

// Экспорт: appointmentsCached придерживает авторитарный cacheReplaceTenant,
// пока в очереди есть ещё реплеящиеся (attempts < MAX_ATTEMPTS) опы.
export const MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [1000, 5000, 30000]; // attempts 1, 2, 3

type Toast = (msg: string) => void;

export interface ReplayerOptions {
  supabase: DbSupabase;
  /** OPTIONAL active tenant id (offline-plan risk #1, second half). When
   *  supplied, an op whose `payload.tenant_id` is present and DIFFERENT is
   *  skipped — never drained under this session — so a queue entry left by a
   *  previous tenant (a cacheClearAll wipe that was missed on the tenant
   *  switch) can't replay onto the server under the current tenant's auth.
   *  Absent = no tenant gating. Skipped ops stay in the queue
   *  rather than being discarded — the wipe on the next clean switch removes
   *  them. */
  tenantId?: string;
  /** OPTIONAL quota gate — see QuotaGate. Absent = no gating. */
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

// Cached wrappers deliberately know nothing about the host application: they
// can enqueue an op and call `kickReplayer({ supabase })`, but they cannot
// import the mobile quota/notification adapters. Keep those host adapters as
// process defaults so EVERY kick (including a wrapper's immediate retry after
// a network blip) uses the same safety policy as the NetInfo runtime kick.
// The explicit call options still win, which keeps tests and other hosts
// deterministic.
export type ReplayerDefaults = Omit<ReplayerOptions, "supabase">;
let replayerDefaults: ReplayerDefaults = {};

export function setReplayerDefaults(
  defaults: ReplayerDefaults | null,
): void {
  replayerDefaults = defaults ? { ...defaults } : {};
}

function withReplayerDefaults(opts: ReplayerOptions): ReplayerOptions {
  return { ...replayerDefaults, ...opts, supabase: opts.supabase };
}

/** Public trigger — call from `online` listener, onResync, manual
 *  retry button, or after a write failed mid-flight. Idempotent
 *  and self-coalescing. */
export async function kickReplayer(opts: ReplayerOptions): Promise<void> {
  const effectiveOpts = withReplayerDefaults(opts);
  if (draining) {
    pendingFollowup = true;
    return;
  }
  draining = true;
  try {
    await drain(effectiveOpts);
    if (pendingFollowup) {
      pendingFollowup = false;
      // Run one follow-up pass synchronously so coalesced triggers
      // get a chance to flush the queue without recursion explosion.
      await drain(effectiveOpts);
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
    const queuedClientTagIds =
      op.table === "clients" && Array.isArray(payload.__tag_ids)
        ? payload.__tag_ids.filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          )
        : [];
    if (op.table === "clients" && "__tag_ids" in payload) {
      const { __tag_ids: _queueMetadata, ...databasePayload } = payload;
      void _queueMetadata;
      payload = databasePayload;
    }

    // A client plus its tag assignments is one aggregate. Replaying it as a
    // direct INSERT followed by junction upserts could leave a half-created
    // client after a crash/RLS error. When tags are present, use the same
    // transaction-owning RPC as the online repository. A lost successful
    // response is repaired idempotently through update_client_with_tags on
    // the next duplicate-key attempt.
    if (op.table === "clients" && queuedClientTagIds.length > 0) {
      if (!isUuid(op.row_id)) {
        throw new Error(
          "replay client tags: client id is not a UUID; aggregate cannot be restored",
        );
      }
      const tenantId = payload.tenant_id;
      if (typeof tenantId !== "string" || tenantId.length === 0) {
        throw new Error("replay client tags: tenant_id is missing");
      }
      // Тот же белый список, что и у онлайн-записи: RPC не принимает
      // идентичность, сторожок LWW и `purge_at` (срок корзины ставит только
      // удаление прямым UPDATE). Лишний ключ = отказ 22023 на всю очередь.
      const {
        id: _id,
        tenant_id: _tenantId,
        updated_at: _updatedAt,
        purge_at: _purgeAt,
        ...clientPayload
      } = payload;
      void _id;
      void _tenantId;
      void _updatedAt;
      void _purgeAt;
      const { error: aggregateError } = await supabase.rpc(
        "create_client_with_tags",
        {
          p_tenant_id: tenantId,
          p_client_id: op.row_id,
          p_client: clientPayload as Json,
          p_tag_ids: [...new Set(queuedClientTagIds)],
        },
      );
      if (aggregateError) {
        const duplicate =
          aggregateError.code === "23505" ||
          /duplicate key/i.test(aggregateError.message);
        if (!duplicate) {
          const unavailable =
            aggregateError.code === "PGRST202" ||
            /could not find the function|schema cache|does not exist/i.test(
              aggregateError.message,
            );
          throw new Error(
            unavailable
              ? "Безопасная синхронизация меток клиента ждёт обновления серверной схемы. Локальный клиент сохранён и останется в очереди."
              : `replay client aggregate: ${aggregateError.message}`,
          );
        }
        const { error: repairError } = await supabase.rpc(
          "update_client_with_tags",
          {
            p_tenant_id: tenantId,
            p_client_id: op.row_id,
            p_patch: {},
            p_tag_ids: [...new Set(queuedClientTagIds)],
          },
        );
        if (repairError) {
          throw new Error(`replay client aggregate repair: ${repairError.message}`);
        }
      }
      return false;
    }
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
      // 23505 бывает ДВУХ РАЗНЫХ смыслов, и раньше они путались:
      //   • конфликт по ПЕРВИЧНОМУ ключу — строка действительно уже на
      //     сервере (ответ прошлой попытки потерялся), операцию можно снять;
      //   • конфликт по ДРУГОМУ уникальному индексу — например,
      //     clients_tenant_phone_e164_idx: номер занят ЧУЖИМ клиентом.
      //     Строки на сервере НЕТ, и снятие операции молча хоронило
      //     созданного офлайн клиента вместе с его объектами и заметками:
      //     на телефоне он есть, на сервере его никогда не будет.
      // Поэтому спрашиваем сервер прямо: есть ли строка с этим id.
      const probe = await supabase
        .from(tableName)
        .select("id")
        .eq("id", op.row_id)
        .maybeSingle();
      if (!probe.data) {
        throw new Error(
          tableName === "clients"
            ? "Клиент с таким номером уже заведён — откройте его карточку, а этот черновик удалите"
            : `replay insert: ${error.message}`,
        );
      }
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
      if (op.table === "clients" && forced.deleted_at != null) {
        // Soft archive is represented by UPDATE, but the clients SQLite table
        // is the active-list cache. A last-write-wins retry must keep the row
        // hidden instead of re-inserting the archived server response.
        await cacheDelete("clients", op.row_id);
        return true;
      }
      // Cache write-through with the canonical row. Кэш хранит
      // ДОМЕННУЮ форму (cache-of-domain, slice 5) — сырую серверную
      // Row прогоняем через тот же row→domain маппер, что и обычное
      // чтение (иначе строка без photos:[] и с numeric-строками).
      // Прошлая строка кэша нужна, чтобы не потерять теги: обычный UPDATE
      // не трогает назначения, а в ответе их нет.
      const prevCached =
        op.table === "clients"
          ? await cacheGetOne<CachedClientData>("clients", op.row_id).catch(
              () => null,
            )
          : null;
      await cacheUpsert(
        op.table as CachedTable,
        toCachedRow(op.table, forced, prevCached),
      );
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

/** Каноническая серверная Row из force-update → строка кэша. Кэш
 *  appointments хранит ДОМЕННУЮ форму + tenant_id (cache-of-domain,
 *  slice 5) — прогоняем через маппер обычного чтения. clients/tags
 *  оставлены как были: их row→domain мапперы приватны в своих
 *  репозиториях, а строка самовосстанавливается на ближайшем полном
 *  refetch (foreground revalidate / realtime). */
function toCachedRow(
  table: QueuedOp["table"],
  row: Record<string, unknown>,
  /** Прошлая строка кэша — из неё берём то, чего нет в ответе UPDATE. */
  previous?: Partial<CachedClientData> | null,
): CachedClient | CachedTag | CachedAppointmentData | CachedClientData {
  if (table === "appointments") {
    const r = row as Database["public"]["Tables"]["appointments"]["Row"];
    return { ...rowToAppointment(r), tenant_id: r.tenant_id };
  }
  if (table === "clients") {
    // Кэш клиентов хранит ДОМЕННУЮ форму (Client + tenant_id + updated_at).
    // Раньше сюда клалась СЫРАЯ серверная строка: у неё нет tag_ids, и
    // вкладка «Клиенты» падала на `client.tag_ids.map` сразу после любого
    // конфликта LWW.
    const r = row as Database["public"]["Tables"]["clients"]["Row"];
    const prevTags = previous?.tag_ids;
    return {
      ...rowToClient(r),
      // Обычный UPDATE не трогает назначения тегов — сохраняем известные.
      tag_ids: Array.isArray(prevTags) ? (prevTags as string[]) : [],
      tenant_id: r.tenant_id,
      updated_at: r.updated_at,
    } satisfies CachedClientData;
  }
  return row as CachedTag;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
