// Shapes of the notification scheduler. The only module of the folder that
// names the native package, and it does so for types alone: nothing here runs.
import type {
  NotificationContentInput,
  NotificationRequest,
} from "expo-notifications";

export type NativeNotificationRequest = NotificationRequest;

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

export type StoredNotification = {
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  revision: string;
  content: NotificationContentInput;
};

export type ManagedNativeNotification = {
  identifier: string;
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  revision: string;
};

export type ReconcileResult = {
  status: BabunNotificationScheduleStatus;
  identifiersByOwner: Map<string, string[]>;
  deferredCount: number;
};
