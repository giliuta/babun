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

// The implementation lives in ./replayer/: drain (the pass and its gates),
// dispatch + replay-delete / replay-insert / replay-update (one op → PostgREST),
// table-rules + replay-clients (everything table-specific), tenant-refresh,
// guards, options and relay. This file keeps the single-flight scheduling.

import { drain } from "./replayer/drain";
import { isReadOnlyView } from "./replayer/guards";
import type { ReplayerOptions } from "./replayer/options";

export {
  MAX_ATTEMPTS,
  type QuotaGate,
  type ReplayerOptions,
} from "./replayer/options";
export {
  APPOINTMENT_GUARDED_FIELDS,
  GUARDED_CONFLICT_MESSAGE,
  touchesGuardedAppointmentFields,
} from "./replayer/table-rules";
export { holdsTenantRefresh, tenantRefreshHeld } from "./replayer/tenant-refresh";
export { BOUND_TENANT_FIELD, READ_ONLY_VIEW_FIELD } from "./replayer/guards";

let draining = false;
let pendingFollowup = false;

// ОБРЫВ СВЯЗИ — НЕ ОТКАЗ СЕРВЕРА. Если бы любая ошибка шла в счёт попыток
// (подвал, туннель, 503 или минута заморозки базы), за ~6 секунд (1 с + 5 с
// отката) каждая правка набрала бы MAX_ATTEMPTS и стала «навсегда не
// отправленной»: после возврата сети она уже не уходила бы, а сервер
// перечитывал бы календарь поверх неё. Поэтому обрыв попытку не тратит: строка ждёт, остальные уходят, а слив повторяется сам через
// TRANSIENT_RETRY_MS (и сразу — при возврате сети). В счёт идут только ответы
// сервера, которые повтором не лечатся: RLS, ограничения, 4xx.
export const TRANSIENT_RETRY_MS = 30_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTransientRetry(opts: ReplayerOptions): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void kickReplayer(opts);
  }, TRANSIENT_RETRY_MS);
}

/** ТОЛЬКО ДЛЯ ТЕСТОВ. Обёртки кэша зовут `void kickReplayer(...)` не дожидаясь
 *  ответа; когда такой вызов ещё в полёте на границе двух тестовых файлов,
 *  следующий файл получает `draining = true` и все его kick-и молча выходят
 *  (на CI-раннере Linux это воспроизводилось стабильно: очередь не сливалась,
 *  к серверу никто не обращался). Снимаем засов перед каждым тестом. */
export function __resetReplayerForTests(): void {
  draining = false;
  pendingFollowup = false;
  replayerDefaults = {};
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

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

/** Опции слива с умолчаниями хоста; `null` — сливать нечем (звавший дал
 *  вид только для чтения, а клиента хоста нет). */
function withReplayerDefaults(opts: ReplayerOptions): ReplayerOptions | null {
  const merged = { ...replayerDefaults, ...opts };
  const supabase = isReadOnlyView(opts.supabase) ? merged.writeClient : opts.supabase;
  return supabase ? { ...merged, supabase } : null;
}

/** Public trigger — call from `online` listener, onResync, manual
 *  retry button, or after a write failed mid-flight. Idempotent
 *  and self-coalescing. */
export async function kickReplayer(opts: ReplayerOptions): Promise<void> {
  const effectiveOpts = withReplayerDefaults(opts);
  if (!effectiveOpts) return;
  if (draining) {
    pendingFollowup = true;
    return;
  }
  draining = true;
  try {
    await drain(effectiveOpts, () => scheduleTransientRetry(effectiveOpts));
    if (pendingFollowup) {
      pendingFollowup = false;
      // Run one follow-up pass synchronously so coalesced triggers
      // get a chance to flush the queue without recursion explosion.
      await drain(effectiveOpts, () => scheduleTransientRetry(effectiveOpts));
    }
  } finally {
    draining = false;
  }
}

/** Погасить взведённый повтор слива. Таймер держит опции запуска и без этого
 *  стрелял и после остановки рантайма — в том числе после выхода из аккаунта.
 *  Рантайм хоста зовёт это при остановке и паузе. */
export function cancelReplayerRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
