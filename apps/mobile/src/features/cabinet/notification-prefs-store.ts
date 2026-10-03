import { useSyncExternalStore } from "react";
import { getStorage } from "@babun/shared/storage";
import {
  DEFAULT_NOTIFICATION_PREFS,
  normalizeNotificationPrefs,
  type NotificationPrefs,
} from "./notification-prefs";

// Хранилище настроек уведомлений — MMKV этого телефона. Правила — в
// `notification-prefs.ts`; здесь чтение, запись и подписка экрана.

const KEY = "babun:notifications.prefs.v1";
const listeners = new Set<() => void>();
let cache: NotificationPrefs | null = null;

export function readNotificationPrefs(): NotificationPrefs {
  if (cache) return cache;
  try {
    cache = normalizeNotificationPrefs(getStorage().get<unknown>(KEY));
  } catch {
    cache = DEFAULT_NOTIFICATION_PREFS;
  }
  return cache;
}

export function writeNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = normalizeNotificationPrefs({ ...readNotificationPrefs(), ...patch });
  cache = next;
  try {
    getStorage().set(KEY, next);
  } catch {
    // Запись best-effort: настройка живёт в памяти до перезапуска.
  }
  for (const listener of listeners) listener();
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotificationPrefs(): NotificationPrefs {
  return useSyncExternalStore(subscribe, readNotificationPrefs, readNotificationPrefs);
}
