// STORY-062 slice 3 — no-op quota gate for the mobile replayer.
//
// The web replayer imported a real tier-quota checker (`@/lib/quota/check`)
// that RPC-counts clients/appointments before an offline INSERT replays.
// The mobile app has no such façade yet and is web-parity (it caches only
// the 3 tables and never enforced quota on device), so it injects THIS
// no-op gate into the shared replayer's `ReplayerOptions.quota`.
//
// `assertAvailable` never throws → the replayer's quota branch is a pass-
// through (identical to "quota always available"). The server + the
// STORY-052b BEFORE INSERT trigger remain the real enforcement point. If we
// ever add a device-side quota RPC, swap the body here to throw an error
// carrying `{ quota: true, message }` and the replayer will perm-fail the
// over-quota op exactly like the web version.

import type { QuotaGate } from "@babun/shared/sync";

export const quotaGate: QuotaGate = {
  assertAvailable() {
    // no-op — see module header.
  },
};
