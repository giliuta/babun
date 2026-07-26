// card-booking — one shared «записать» deep-link for every surface on the
// client card (NEXT-JOB hero, ряд действий card-actions, «Обслуживание»
// spine, per-object «Записать сюда»). Navigates to the calendar tab with `new=1` +
// client/location/team; the `?new=` handler in app/(dashboard)/index.tsx
// switches to that client's team calendar (so the new record is visible on
// return) and then pushes the separate /book screen pre-aimed at the client.

import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { haptics } from "@/lib/haptics";

export interface BookingTarget {
  clientId: string;
  locationId?: string | null;
  teamId?: string | null;
  /** Услуги для предзаполнения — из последнего завершённого визита.
   *  Экран записи читает их из параметра `services` (id через запятую). */
  serviceIds?: readonly string[];
}

/** Returns a stable-enough callback that opens the calendar pre-aimed at
 *  the given client/object/team. */
export function useBookingNav(): (target: BookingTarget) => void {
  const router = useRouter();
  return ({ clientId, locationId, teamId, serviceIds }: BookingTarget) =>
    router.push({
      pathname: "/(dashboard)",
      params: {
        new: "1",
        clientId,
        ...(locationId ? { locationId } : {}),
        ...(teamId ? { teamId } : {}),
        ...(serviceIds && serviceIds.length
          ? { services: serviceIds.join(",") }
          : {}),
      },
    });
}

/** То же, но с предупреждением о чёрном списке. Записать такого клиента
 *  можно, но не молча — и это правило должно быть одно на все точки записи
 *  (ряд действий карточки, «Обслуживание», страница объекта), иначе одна из
 *  них тихо проведёт мимо предупреждения. */
export function useGuardedBookingNav(): (
  client: Client,
  target: Omit<BookingTarget, "clientId">,
) => void {
  const book = useBookingNav();
  return (client, target) => {
    haptics.tap();
    const go = () => book({ ...target, clientId: client.id });
    if (client.blacklisted) {
      Alert.alert("Клиент в чёрном списке", "Всё равно записать?", [
        { text: "Отмена", style: "cancel" },
        { text: "Записать", onPress: go },
      ]);
      return;
    }
    go();
  };
}
