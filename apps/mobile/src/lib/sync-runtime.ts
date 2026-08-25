// STORY-062 slice 3 — mobile sync-runtime.
//
// Assembles the shared replayer's ReplayerOptions for this app and wires the
// drain trigger to connectivity. This is the RN equivalent of the web app's
// `online` listener + realtime onResync callback that kick the replayer.
//
// What it wires:
//   • ReplayerOptions.supabase   — the app's authed client (lib/supabase)
//   • ReplayerOptions.tenantId   — the active workspace; stale-tenant queue
//                                  entries are never replayed in this session
//   • ReplayerOptions.quota      — live server-backed tier-limit checks
//   • ReplayerOptions.onConflict — Alert «Конфликт синхронизации»: the LWW
//                                  force-update applied the local edit over a
//                                  newer server row
//   • ReplayerOptions.onChanged  — invalidate the three cached query trees so
//                                  the UI re-reads after a drain
//   • trigger — onlineManager.subscribe(online => online && kickReplayer),
//     which already tracks NetInfo (query-client.ts), plus one kick at start
//     to flush any queue left over from a previous offline session.

import { onlineManager } from "@tanstack/react-query";
import {
  kickReplayer,
  setReplayerDefaults,
  setSyncToast,
  type QuotaGate,
} from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { notify } from "./notify";
import { queryClient } from "@/lib/query-client";
import { quotaGate } from "@/lib/quota-gate";

// Infer the options from the public function so this host adapter stays in
// lockstep with the shared replayer contract.
function buildReplayerOptions(
  tenantId: string,
): Parameters<typeof kickReplayer>[0] {
  const quota: QuotaGate = quotaGate;
  return {
    supabase,
    tenantId,
    quota,
    onConflict: (msg: string) => {
      notify("Конфликт синхронизации", msg);
    },
    onPermanentFailure: (op) => {
      notify(
        "Изменение не синхронизировано",
        op.last_error ||
          "Сервер окончательно отклонил offline-изменение. Обновите данные и повторите действие.",
      );
    },
    onChanged: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client-tags"] });
    },
  };
}

let started = false;
let unsubscribe: (() => void) | null = null;
let activeTenantId: string | null = null;

/** Idempotent. Subscribes the replayer to connectivity and kicks one drain
 *  at startup. Safe to call more than once (guards against double-mount in
 *  React strict/dev). */
export function startSyncRuntime(tenantId: string): () => void {
  if (started) return unsubscribe ?? (() => {});
  started = true;
  activeTenantId = tenantId;

  const opts = buildReplayerOptions(tenantId);
  // Cached wrappers also kick the shared replayer directly after a transient
  // write failure. Register the host policy once so those kicks cannot bypass
  // quota checks or permanent-failure feedback.
  setReplayerDefaults({
    tenantId: opts.tenantId,
    quota: opts.quota,
    onConflict: opts.onConflict,
    onChanged: opts.onChanged,
    onPermanentFailure: opts.onPermanentFailure,
  });
  // The clients wrapper intentionally refuses junction-table tag edits while
  // offline. Its warning adapter used to remain the default no-op on mobile,
  // making the Save action look successful. Make the limitation explicit.
  setSyncToast((message) => notify("Изменение не сохранено", message));

  // Drain whenever connectivity flips to online. onlineManager is already
  // bound to NetInfo in query-client.ts, so this covers airplane-mode
  // recovery, tunnel exit, Wi-Fi handover, etc.
  unsubscribe = onlineManager.subscribe((online: boolean) => {
    if (online) void kickReplayer(opts);
  });

  // One kick at start to flush a queue carried over from a prior offline
  // session (the app may boot already-online with pending ops).
  if (onlineManager.isOnline()) {
    void kickReplayer(opts);
  }

  return () => {
    unsubscribe?.();
    unsubscribe = null;
    started = false;
    activeTenantId = null;
    setReplayerDefaults(null);
    setSyncToast(() => {});
  };
}

/** Stop queue drains during an active-tenant switch. Clearing SQLite while a
 * replayer is being triggered by NetInfo could otherwise repopulate it with
 * the old tenant after the wipe. The returned callback restores the prior
 * runtime only when the switch fails; a successful switch is remounted by the
 * tenant-scoped React effect with the new tenant id. */
export function pauseSyncRuntimeForTenantSwitch(): () => void {
  const wasStarted = started;
  const previousTenantId = activeTenantId;
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  activeTenantId = null;
  setReplayerDefaults(null);
  setSyncToast(() => {});
  return () => {
    if (wasStarted && previousTenantId && !started) {
      startSyncRuntime(previousTenantId);
    }
  };
}
