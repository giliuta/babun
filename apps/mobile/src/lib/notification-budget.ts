/**
 * iOS keeps at most 64 pending local notification requests per application.
 * Babun deliberately reserves four slots for native/system integrations and
 * schedules only the nearest 60 CRM reminders. Android has no equivalent
 * small hard limit, but a finite cap still protects storage and startup time.
 */
export const IOS_BABUN_NOTIFICATION_BUDGET = 60;
const ANDROID_BABUN_NOTIFICATION_BUDGET = 256;
// Keep a larger, still finite desired queue so reminders beyond the current
// native window are promoted on a later launch instead of being forgotten.
export const PERSISTED_BABUN_NOTIFICATION_BUDGET = 2_048;

export interface NotificationBudgetCandidate {
  logicalId: string;
  fireAt: number;
}

export type NotificationOwnerDisposition =
  | "scheduled"
  | "deferred"
  | "capacity";

export function platformNotificationBudget(
  platform: "ios" | "android" | "web" | string,
): number {
  return platform === "ios"
    ? IOS_BABUN_NOTIFICATION_BUDGET
    : ANDROID_BABUN_NOTIFICATION_BUDGET;
}

/** Keep one current version of each logical reminder and select nearest-first. */
export function selectNotificationBudget<
  T extends NotificationBudgetCandidate,
>(candidates: readonly T[], budget: number, now = Date.now()): T[] {
  const latestByLogicalId = new Map<string, T>();
  for (const candidate of candidates) {
    if (
      !candidate.logicalId ||
      !Number.isFinite(candidate.fireAt) ||
      candidate.fireAt <= now
    ) {
      continue;
    }
    latestByLogicalId.set(candidate.logicalId, candidate);
  }
  return [...latestByLogicalId.values()]
    .sort(
      (left, right) =>
        left.fireAt - right.fireAt ||
        left.logicalId.localeCompare(right.logicalId),
    )
    .slice(0, Math.max(0, Math.floor(budget)));
}

/** Describe what happened to one owner's requested reminders. Permission and
 * native failures are handled by the caller before this capacity decision. */
export function notificationOwnerDisposition(
  requestedCount: number,
  acceptedCount: number,
  scheduledCount: number,
): NotificationOwnerDisposition {
  if (acceptedCount < requestedCount) return "capacity";
  if (scheduledCount < acceptedCount) return "deferred";
  return "scheduled";
}

/** Old per-feature registries may contain identifiers now managed by the
 * shared scheduler. Such requests are not legacy and must not be cancelled
 * merely because another owner scope (for example event:) is rebuilt. */
export function unmanagedLegacyNotificationIds(
  legacyIds: readonly string[],
  managedIds: ReadonlySet<string>,
): string[] {
  return [...new Set(legacyIds.filter(Boolean))].filter(
    (identifier) => !managedIds.has(identifier),
  );
}
