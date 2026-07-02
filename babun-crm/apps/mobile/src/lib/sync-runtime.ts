// STORY-062 slice 3 — mobile sync-runtime.
//
// Assembles the shared replayer's ReplayerOptions for this app and wires the
// drain trigger to connectivity. This is the RN equivalent of the web app's
// `online` listener + realtime onResync callback that kick the replayer.
//
// IMPORTANT (slice 3 boundary): mounting this does NOT change any mutation
// path. The cached-wrappers exist and the replayer can drain the queue, but
// the calendar/clients/tags mutationFns still call the repositories directly
// (that switch is slice 4). So on a fresh install the queue is always empty
// and kickReplayer is a no-op — this file only lights up once slice 4 starts
// enqueuing offline writes. Wiring it now keeps the subscription lifecycle in
// place and lets us smoke-test the drain end-to-end.
//
// What it wires:
//   • ReplayerOptions.supabase   — the app's authed client (lib/supabase)
//   • ReplayerOptions.quota      — the no-op gate (lib/quota); the mobile app
//                                  doesn't enforce tier quota on device
//   • ReplayerOptions.onConflict — Alert «Конфликт синхронизации»: the LWW
//                                  force-update applied the local edit over a
//                                  newer server row
//   • ReplayerOptions.onChanged  — invalidate the three cached query trees so
//                                  the UI re-reads after a drain
//   • trigger — onlineManager.subscribe(online => online && kickReplayer),
//     which already tracks NetInfo (query-client.ts), plus one kick at start
//     to flush any queue left over from a previous offline session.

import { Alert } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { kickReplayer, type QuotaGate } from "@babun/shared/sync";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { quotaGate } from "@/lib/quota";

// A ReplayerOptions object without re-importing the interface (it isn't
// exported from the barrel — we only need the shape kickReplayer accepts).
function buildReplayerOptions(): Parameters<typeof kickReplayer>[0] {
  const quota: QuotaGate = quotaGate;
  return {
    supabase,
    quota,
    onConflict: (msg: string) => {
      Alert.alert("Конфликт синхронизации", msg);
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

/** Idempotent. Subscribes the replayer to connectivity and kicks one drain
 *  at startup. Safe to call more than once (guards against double-mount in
 *  React strict/dev). */
export function startSyncRuntime(): () => void {
  if (started) return unsubscribe ?? (() => {});
  started = true;

  const opts = buildReplayerOptions();

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
  };
}
