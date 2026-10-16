import {
  notificationOwnerDisposition,
  platformNotificationBudget,
  selectNotificationBudget,
  unmanagedLegacyNotificationIds,
} from "@/lib/notification-budget";

import { appendIdentifier, managedNativeNotification } from "./notifications/managed";
import { enqueueScheduler } from "./notifications/queue";
import {
  cleanContentData,
  desiredDraftCount,
  normalizeDraft,
  readRegistry,
  retainedRegistry,
  writeRegistry,
} from "./notifications/registry";
import type {
  BabunNotificationDraft,
  BabunNotificationOwnerDrafts,
  BabunNotificationOwnerResult,
  BabunNotificationScheduleStatus,
  ManagedNativeNotification,
  ReconcileResult,
  StoredNotification,
} from "./notifications/types";

// The registry, its snapshot and the shapes live in `./notifications/`; the
// native module and everything that calls it stays in this file.
export {
  babunNotificationRegistrySnapshot,
  subscribeBabunNotificationRegistry,
  type ScheduledBabunNotification,
} from "./notifications/registry";
export type {
  BabunNotificationDraft,
  BabunNotificationOwnerDrafts,
  BabunNotificationOwnerResult,
  BabunNotificationScheduleStatus,
} from "./notifications/types";

// One guarded entry point for the native notifications module. Keeping the
// require here lets older development builds open the app even when they were
// compiled before expo-notifications was added.
let Notifications: typeof import("expo-notifications") | null = null;
let nativePlatform = "ios";

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}
try {
  // Keep pure reminder/parser tests runnable outside Metro. The conservative
  // fallback is iOS, whose pending-notification cap is the stricter one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativePlatform = require("react-native").Platform.OS;
} catch {
  nativePlatform = "ios";
}

// Expo does not present a notification while the app is foregrounded unless
// the app supplies a handler. A dispatcher can leave Babun open on the
// calendar all day, so reminders must still surface in that state.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function getNotificationsModule(): typeof import("expo-notifications") | null {
  return Notifications;
}

function nativeRegistry(
  candidates: readonly StoredNotification[],
  now = Date.now(),
): StoredNotification[] {
  return selectNotificationBudget(
    candidates,
    platformNotificationBudget(nativePlatform),
    now,
  );
}

async function reconcileNativeLocked(
  registry: readonly StoredNotification[],
  requestPermission: boolean,
  legacyIds: readonly string[] = [],
): Promise<ReconcileResult> {
  if (!Notifications) {
    return {
      status: "unavailable",
      identifiersByOwner: new Map(),
      deferredCount: registry.length,
    };
  }

  let pending: import("expo-notifications").NotificationRequest[];
  try {
    pending = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    return {
      status: "unavailable",
      identifiersByOwner: new Map(),
      deferredCount: registry.length,
    };
  }

  const desiredById = new Map(registry.map((item) => [item.logicalId, item]));
  const keptByLogicalId = new Map<string, ManagedNativeNotification>();
  const managedByNativeId = new Map<string, ManagedNativeNotification>();
  for (const request of pending) {
    const managed = managedNativeNotification(request);
    if (managed) managedByNativeId.set(request.identifier, managed);
  }
  const cancelIds = new Set(
    unmanagedLegacyNotificationIds(
      legacyIds,
      new Set(managedByNativeId.keys()),
    ),
  );

  for (const request of pending) {
    const managed = managedByNativeId.get(request.identifier);
    if (!managed) continue;
    const desired = desiredById.get(managed.logicalId);
    const exact =
      desired &&
      desired.ownerKey === managed.ownerKey &&
      desired.fireAt === managed.fireAt &&
      desired.revision === managed.revision;
    if (!exact || keptByLogicalId.has(managed.logicalId)) {
      cancelIds.add(managed.identifier);
    } else {
      keptByLogicalId.set(managed.logicalId, managed);
    }
  }

  await Promise.all(
    [...cancelIds].map((identifier) =>
      Notifications!.cancelScheduledNotificationAsync(identifier).catch(
        () => {},
      ),
    ),
  );

  let remaining: import("expo-notifications").NotificationRequest[];
  try {
    remaining = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    remaining = pending.filter((request) => !cancelIds.has(request.identifier));
  }

  // Rebuild the exact kept set after cancellation. A cancellation may fail,
  // and its request must still count against iOS' hard pending limit.
  keptByLogicalId.clear();
  const identifiersByOwner = new Map<string, string[]>();
  for (const request of remaining) {
    const managed = managedNativeNotification(request);
    if (!managed || keptByLogicalId.has(managed.logicalId)) continue;
    const desired = desiredById.get(managed.logicalId);
    if (
      desired &&
      desired.ownerKey === managed.ownerKey &&
      desired.fireAt === managed.fireAt &&
      desired.revision === managed.revision
    ) {
      keptByLogicalId.set(managed.logicalId, managed);
      appendIdentifier(
        identifiersByOwner,
        managed.ownerKey,
        managed.identifier,
      );
    }
  }

  const missing = registry.filter(
    (item) => !keptByLogicalId.has(item.logicalId),
  );
  if (missing.length === 0) {
    return {
      status: "scheduled",
      identifiersByOwner,
      deferredCount: 0,
    };
  }

  let granted = false;
  try {
    const permission = requestPermission
      ? await Notifications.requestPermissionsAsync()
      : await Notifications.getPermissionsAsync();
    granted = permission.granted;
  } catch {
    return {
      status: "unavailable",
      identifiersByOwner,
      deferredCount: missing.length,
    };
  }
  if (!granted) {
    return {
      status: "denied",
      identifiersByOwner,
      deferredCount: missing.length,
    };
  }

  const nativeLimit = platformNotificationBudget(nativePlatform);
  let pendingCount = remaining.length;
  let failed = false;
  for (const item of missing) {
    if (pendingCount >= nativeLimit) break;
    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          ...item.content,
          data: {
            ...cleanContentData(item.content.data),
            babunManaged: true,
            babunLogicalId: item.logicalId,
            babunOwnerKey: item.ownerKey,
            babunFireAt: item.fireAt,
            babunRevision: item.revision,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(item.fireAt),
        },
      });
      appendIdentifier(identifiersByOwner, item.ownerKey, identifier);
      pendingCount += 1;
    } catch {
      failed = true;
    }
  }

  const scheduledCount = [...identifiersByOwner.values()].reduce(
    (total, identifiers) => total + identifiers.length,
    0,
  );
  return {
    status: failed ? "unavailable" : "scheduled",
    identifiersByOwner,
    deferredCount: Math.max(0, registry.length - scheduledCount),
  };
}

async function replaceOwnersLocked(
  removeOwner: (ownerKey: string) => boolean,
  owners: readonly BabunNotificationOwnerDrafts[],
  requestPermission: boolean,
  legacyIds: readonly string[] = [],
): Promise<ReconcileResult> {
  const next = readRegistry().filter((item) => !removeOwner(item.ownerKey));
  for (const owner of owners) {
    for (const draft of owner.drafts) {
      const normalized = normalizeDraft(owner.ownerKey, draft);
      if (normalized) next.push(normalized);
    }
  }
  const retained = retainedRegistry(next);
  const scheduledWindow = nativeRegistry(retained);
  writeRegistry(retained);
  const result = await reconcileNativeLocked(
    scheduledWindow,
    requestPermission,
    legacyIds,
  );
  return {
    ...result,
    deferredCount:
      result.deferredCount + retained.length - scheduledWindow.length,
  };
}

/** Replace one logical owner's reminders and rebalance the global native cap. */
export function replaceBabunNotificationOwner(
  ownerKey: string,
  drafts: readonly BabunNotificationDraft[],
  options: {
    requestPermission?: boolean;
    legacyIds?: readonly string[];
  } = {},
): Promise<BabunNotificationOwnerResult> {
  return enqueueScheduler(async () => {
    const requestedCount = desiredDraftCount(ownerKey, drafts);
    const result = await replaceOwnersLocked(
      (candidate) => candidate === ownerKey,
      [{ ownerKey, drafts }],
      options.requestPermission ?? true,
      options.legacyIds,
    );
    const identifiers = result.identifiersByOwner.get(ownerKey) ?? [];
    const acceptedCount = readRegistry().filter(
      (item) => item.ownerKey === ownerKey,
    ).length;
    const status =
      result.status === "scheduled"
        ? notificationOwnerDisposition(
            requestedCount,
            acceptedCount,
            identifiers.length,
          )
        : result.status;
    return {
      status,
      identifiers,
      deferredCount: result.deferredCount,
    };
  });
}

/** Atomically rebuild an authoritative owner scope (for DB-backed events). */
export function replaceBabunNotificationScope(
  scopePrefix: string,
  owners: readonly BabunNotificationOwnerDrafts[],
  options: {
    requestPermission?: boolean;
    legacyIds?: readonly string[];
  } = {},
): Promise<BabunNotificationScheduleStatus> {
  return enqueueScheduler(async () => {
    const validOwners = owners.filter((owner) =>
      owner.ownerKey.startsWith(scopePrefix),
    );
    const result = await replaceOwnersLocked(
      (ownerKey) => ownerKey.startsWith(scopePrefix),
      validOwners,
      options.requestPermission ?? false,
      options.legacyIds,
    );
    return result.status;
  });
}

export function removeBabunNotificationOwners(
  ownerKeys: readonly string[],
  legacyIds: readonly string[] = [],
): Promise<void> {
  const targets = new Set(ownerKeys);
  return enqueueScheduler(async () => {
    await replaceOwnersLocked(
      (ownerKey) => targets.has(ownerKey),
      [],
      false,
      legacyIds,
    );
  });
}

/** Restore persisted schedules after process/native rebuild without prompting. */
export function reconcileBabunNotifications(): Promise<BabunNotificationScheduleStatus> {
  return enqueueScheduler(async () => {
    const retained = retainedRegistry(readRegistry());
    writeRegistry(retained);
    return (await reconcileNativeLocked(nativeRegistry(retained), false)).status;
  });
}

/** Remove every notification owned by this app before a logout/account
 * switch. Native scheduled notifications outlive MMKV and the JS process, so
 * clearing only local caches could expose the previous tenant's client/job on
 * a shared iPhone hours later. Cleanup is best-effort: a missing native module
 * must never prevent the user from signing out. */
async function clearNativeNotificationsLocked(): Promise<void> {
  if (!Notifications) return;
  await Promise.all([
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => {}),
    Notifications.dismissAllNotificationsAsync().catch(() => {}),
    Notifications.clearLastNotificationResponseAsync().catch(() => {}),
  ]);
}

/** Stop lock-screen delivery immediately when auth disappears, while keeping
 * the logical queue. A transient refresh-token SIGNED_OUT can then recover
 * reminders after SIGNED_IN without ever exposing PII while signed out. */
export function suspendAllBabunNotifications(): Promise<void> {
  return enqueueScheduler(clearNativeNotificationsLocked);
}

export function clearAllBabunNotifications(): Promise<void> {
  return enqueueScheduler(async () => {
    writeRegistry([]);
    await clearNativeNotificationsLocked();
  });
}
