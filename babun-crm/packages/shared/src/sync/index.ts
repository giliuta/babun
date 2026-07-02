// STORY-062 sync namespace barrel.
//
// Public API for `@babun/shared/sync`. Mobile (and the shared sync layer)
// import from here.
//
// The three cached-wrappers (clientsCached / appointmentsCached /
// tagsCached) all export the SAME function names (createX / updateX /
// deleteX / listX) for different tables, so they CANNOT be flat-re-exported
// without collision. Consumers import them by module path instead —
//   import { createClient } from "@babun/shared/sync/clientsCached"
// (resolved via the package's `./sync/*` export). This barrel re-exports
// only the collision-free surface: the replayer, network/queue/format/error
// helpers, the shared toast setter, and the RN-safe uuid.

export {
  isOnline,
  subscribeNetwork,
  useIsOnline,
} from "./network";

export {
  kickReplayer,
  type QuotaGate,
} from "./replayer";

// `setSyncToast` is exported identically by all three wrappers (same
// module-local `toastWarning`). Re-export it once from clientsCached so the
// app can wire the toast in one call; the appointments/tags copies stay
// reachable via their own module paths.
export { setSyncToast } from "./clientsCached";

export { randomUuid } from "./uuid";

export {
  emitQueueChange,
  subscribeQueueChange,
  enqueueOpAndEmit,
  enqueueOpWithCacheUpsertAndEmit,
  enqueueOpWithCacheDeleteAndEmit,
  removeOpAndEmit,
  bumpAttemptAndEmit,
  markOpPermanentlyFailedAndEmit,
  resetOpAttemptsAndEmit,
  useQueueDepth,
} from "./queue-events";

export {
  emitRevalidated,
  subscribeRevalidated,
  cacheSignature,
} from "./revalidate-events";

export {
  startRealtimeTenantSync,
  type RealtimeTenantSyncOptions,
} from "./realtime";

export { labelForOp, relativeTime, pluralizeOps } from "./format";

export {
  reportSyncError,
  clearSyncError,
  useSyncError,
  setSyncErrorTelemetry,
  type SyncErrorState,
} from "./sync-error-bus";
