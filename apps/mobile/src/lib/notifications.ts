import type { NotificationContentInput } from "expo-notifications";
import { getStorage } from "@babun/shared/storage";
import {
  PERSISTED_BABUN_NOTIFICATION_BUDGET,
  notificationOwnerDisposition,
  platformNotificationBudget,
  selectNotificationBudget,
  unmanagedLegacyNotificationIds,
} from "@/lib/notification-budget";

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

export interface BabunNotificationDraft {
  logicalId: string;
  fireAt: Date;
  content: NotificationContentInput;
}

export interface BabunNotificationOwnerDrafts {
  ownerKey: string;
  drafts: readonly BabunNotificationDraft[];
}

export type BabunNotificationScheduleStatus =
  | "scheduled"
  | "deferred"
  | "capacity"
  | "denied"
  | "unavailable";

export interface BabunNotificationOwnerResult {
  status: BabunNotificationScheduleStatus;
  identifiers: string[];
  deferredCount: number;
}

type StoredNotification = {
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  revision: string;
  content: NotificationContentInput;
};

type ManagedNativeNotification = {
  identifier: string;
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  revision: string;
};

type ReconcileResult = {
  status: BabunNotificationScheduleStatus;
  identifiersByOwner: Map<string, string[]>;
  deferredCount: number;
};

const NOTIFICATION_REGISTRY_KEY = "babun:notifications:logical.v1";
const INTERNAL_DATA_KEYS = new Set([
  "babunManaged",
  "babunLogicalId",
  "babunOwnerKey",
  "babunFireAt",
  "babunRevision",
]);

let schedulerQueue: Promise<void> = Promise.resolve();

function enqueueScheduler<T>(task: () => Promise<T>): Promise<T> {
  const run = schedulerQueue.then(task, task);
  schedulerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function cleanContentData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !INTERNAL_DATA_KEYS.has(key),
    ),
  );
}

function revisionFor(content: NotificationContentInput): string {
  return JSON.stringify({
    title: content.title ?? null,
    subtitle: content.subtitle ?? null,
    body: content.body ?? null,
    sound: content.sound ?? null,
    data: cleanContentData(content.data),
  });
}

function normalizeDraft(
  ownerKey: string,
  draft: BabunNotificationDraft,
): StoredNotification | null {
  const logicalId = draft.logicalId.trim();
  const fireAt = draft.fireAt.getTime();
  if (!ownerKey || !logicalId || !Number.isFinite(fireAt)) return null;
  const content = {
    ...draft.content,
    data: cleanContentData(draft.content.data),
  };
  return {
    logicalId,
    ownerKey,
    fireAt,
    revision: revisionFor(content),
    content,
  };
}

function desiredDraftCount(
  ownerKey: string,
  drafts: readonly BabunNotificationDraft[],
  now = Date.now(),
): number {
  const logicalIds = new Set<string>();
  for (const draft of drafts) {
    const normalized = normalizeDraft(ownerKey, draft);
    if (normalized && normalized.fireAt > now) {
      logicalIds.add(normalized.logicalId);
    }
  }
  return logicalIds.size;
}

function isStoredNotification(value: unknown): value is StoredNotification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<StoredNotification>;
  return (
    typeof item.logicalId === "string" &&
    item.logicalId.length > 0 &&
    typeof item.ownerKey === "string" &&
    item.ownerKey.length > 0 &&
    typeof item.fireAt === "number" &&
    Number.isFinite(item.fireAt) &&
    typeof item.revision === "string" &&
    !!item.content &&
    typeof item.content === "object" &&
    !Array.isArray(item.content)
  );
}

function readRegistry(): StoredNotification[] {
  const raw = getStorage().get<unknown>(NOTIFICATION_REGISTRY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredNotification);
}

function writeRegistry(items: readonly StoredNotification[]): void {
  if (items.length === 0) {
    getStorage().remove(NOTIFICATION_REGISTRY_KEY);
    return;
  }
  getStorage().set(NOTIFICATION_REGISTRY_KEY, items);
}

function retainedRegistry(
  candidates: readonly StoredNotification[],
  now = Date.now(),
): StoredNotification[] {
  return selectNotificationBudget(
    candidates,
    PERSISTED_BABUN_NOTIFICATION_BUDGET,
    now,
  );
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

function managedNativeNotification(
  request: import("expo-notifications").NotificationRequest,
): ManagedNativeNotification | null {
  const data = request.content.data;
  if (!data || data.babunManaged !== true) return null;
  const logicalId =
    typeof data.babunLogicalId === "string"
      ? data.babunLogicalId.trim()
      : "";
  const ownerKey =
    typeof data.babunOwnerKey === "string" ? data.babunOwnerKey.trim() : "";
  const revision =
    typeof data.babunRevision === "string" ? data.babunRevision : "";
  const fireAt =
    typeof data.babunFireAt === "number"
      ? data.babunFireAt
      : Number(data.babunFireAt);
  if (
    !logicalId ||
    !ownerKey ||
    !revision ||
    !Number.isFinite(fireAt)
  ) {
    return null;
  }
  return {
    identifier: request.identifier,
    logicalId,
    ownerKey,
    fireAt,
    revision,
  };
}

function appendIdentifier(
  target: Map<string, string[]>,
  ownerKey: string,
  identifier: string,
): void {
  target.set(ownerKey, [...(target.get(ownerKey) ?? []), identifier]);
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
