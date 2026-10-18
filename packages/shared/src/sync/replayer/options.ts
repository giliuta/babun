// Replayer options, the injectable quota gate and the retry budget.

import type { QueuedOp } from "../../db/cache/sql";
import type { DbSupabase } from "./relay";

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

export function isQuotaError(err: unknown): err is { quota: true; message?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { quota?: unknown }).quota === true
  );
}

// Экспорт: appointmentsCached придерживает авторитарный cacheReplaceTenant,
// пока в очереди есть ещё реплеящиеся (attempts < MAX_ATTEMPTS) опы.
export const MAX_ATTEMPTS = 3;
export const BACKOFFS_MS = [1000, 5000, 30000]; // attempts 1, 2, 3

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
  /** ЖИВОЕ чтение активной компании. `tenantId` — снимок, снятый при запуске
   *  рантайма, и он врёт ровно в тот момент, когда это опаснее всего: компания
   *  теперь свойство УСТРОЙСТВА и меняется без перезапуска, а заголовок
   *  компании обёртка `fetch` ставит в момент ОТПРАВКИ. Значит остаток уже
   *  начатого слива уедет с новым заголовком, о котором снимок не знает.
   *  Отсутствует — работает прежний снимок. */
  currentTenantId?: () => string | null;
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
  /** Настоящий клиент хоста. Им идёт выгрузка, когда звавший дал ВИД ТОЛЬКО
   *  ДЛЯ ЧТЕНИЯ (`READ_ONLY_VIEW_FIELD`); нет — такой заход ничего не
   *  выгружает. Хост кладёт его в умолчания (`setReplayerDefaults`). */
  writeClient?: DbSupabase;
  /** Есть ли сеть (у телефона — NetInfo через onlineManager). Без сети слив
   *  не начинается: каждая отправка упала бы сразу. Нет — считаем «есть». */
  isOnline?: () => boolean;
}
