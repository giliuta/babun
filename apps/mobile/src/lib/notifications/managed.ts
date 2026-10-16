// Reading Babun's own bookkeeping back from a native pending request.
import type {
  ManagedNativeNotification,
  NativeNotificationRequest,
} from "./types";

export function managedNativeNotification(
  request: NativeNotificationRequest,
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

export function appendIdentifier(
  target: Map<string, string[]>,
  ownerKey: string,
  identifier: string,
): void {
  target.set(ownerKey, [...(target.get(ownerKey) ?? []), identifier]);
}
