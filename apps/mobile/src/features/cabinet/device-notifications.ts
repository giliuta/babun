import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  babunNotificationRegistrySnapshot,
  getNotificationsModule,
  subscribeBabunNotificationRegistry,
} from "@/lib/notifications";

import {
  devicePermissionFrom,
  reminderCount,
  reminderDays,
  type DevicePermission,
} from "./device-reminders";

// ЖИВЫЕ ИСТОЧНИКИ «УВЕДОМЛЕНИЙ»: разрешение iOS и реестр напоминаний телефона.
//
// Разрешение меняют в настройках iPhone, вне приложения, поэтому в кэше оно не
// держится: `staleTime: 0`, а focusManager на AppState перечитывает его при
// каждом возвращении в приложение. Реестр пишет планировщик
// (`lib/notifications.ts`), и на запись есть подписка: строка Кабинета меняется
// в ту же секунду, когда в записи нажали «Напомнить».

const DEVICE_PERMISSION_KEY = ["device-notification-permission"] as const;

export function useDevicePermission() {
  return useQuery({
    queryKey: DEVICE_PERMISSION_KEY,
    queryFn: async (): Promise<DevicePermission> => {
      const Notifications = getNotificationsModule();
      if (!Notifications) return "unavailable";
      try {
        return devicePermissionFrom(await Notifications.getPermissionsAsync());
      } catch {
        return "unavailable";
      }
    },
    staleTime: 0,
  });
}

/** «Сейчас», которое сдвигается при заходе на экран и возвращении в
 *  приложение: иначе прозвеневшее напоминание висело бы среди будущих. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return now;
}

export function useDeviceReminders() {
  const registry = useSyncExternalStore(
    subscribeBabunNotificationRegistry,
    babunNotificationRegistrySnapshot,
  );
  const now = useNow();
  return useMemo(() => {
    const days = reminderDays(registry, now);
    return { days, count: reminderCount(days) };
  }, [registry, now]);
}
