// Logical notification registry: the persisted list of what Babun wants on
// the lock screen, independent of what the OS currently holds.
import { getStorage } from "@babun/shared/storage";
import {
  PERSISTED_BABUN_NOTIFICATION_BUDGET,
  selectNotificationBudget,
} from "@/lib/notification-budget";

import type {
  BabunNotificationDraft,
  StoredNotification,
} from "./types";

const NOTIFICATION_REGISTRY_KEY = "babun:notifications:logical.v1";
const INTERNAL_DATA_KEYS = new Set([
  "babunManaged",
  "babunLogicalId",
  "babunOwnerKey",
  "babunFireAt",
  "babunRevision",
]);

export function cleanContentData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => !INTERNAL_DATA_KEYS.has(key),
    ),
  );
}

function revisionFor(content: StoredNotification["content"]): string {
  return JSON.stringify({
    title: content.title ?? null,
    subtitle: content.subtitle ?? null,
    body: content.body ?? null,
    sound: content.sound ?? null,
    data: cleanContentData(content.data),
  });
}

export function normalizeDraft(
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

export function desiredDraftCount(
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

// СНИМОК РЕЕСТРА ДЛЯ КАБИНЕТА («Уведомления»). Одна ссылка до
// следующей записи: `useSyncExternalStore` сравнивает снимки по ссылке, и без
// кэша перерисовывал бы экран на каждом рендере. Реестр пишет только
// `writeRegistry` — сброс снимка и оповещение живут в ней.
export interface ScheduledBabunNotification {
  logicalId: string;
  ownerKey: string;
  fireAt: number;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  data: Record<string, unknown>;
}

let registrySnapshot: readonly ScheduledBabunNotification[] | null = null;
const registryListeners = new Set<() => void>();

export function subscribeBabunNotificationRegistry(
  listener: () => void,
): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function babunNotificationRegistrySnapshot(): readonly ScheduledBabunNotification[] {
  if (!registrySnapshot) {
    registrySnapshot = readRegistry().map((item) => ({
      logicalId: item.logicalId,
      ownerKey: item.ownerKey,
      fireAt: item.fireAt,
      title: typeof item.content.title === "string" ? item.content.title : null,
      subtitle:
        typeof item.content.subtitle === "string" ? item.content.subtitle : null,
      body: typeof item.content.body === "string" ? item.content.body : null,
      data: cleanContentData(item.content.data),
    }));
  }
  return registrySnapshot;
}

export function readRegistry(): StoredNotification[] {
  const raw = getStorage().get<unknown>(NOTIFICATION_REGISTRY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredNotification);
}

export function writeRegistry(items: readonly StoredNotification[]): void {
  if (items.length === 0) {
    getStorage().remove(NOTIFICATION_REGISTRY_KEY);
  } else {
    getStorage().set(NOTIFICATION_REGISTRY_KEY, items);
  }
  registrySnapshot = null;
  for (const listener of registryListeners) listener();
}

export function retainedRegistry(
  candidates: readonly StoredNotification[],
  now = Date.now(),
): StoredNotification[] {
  return selectNotificationBudget(
    candidates,
    PERSISTED_BABUN_NOTIFICATION_BUDGET,
    now,
  );
}
