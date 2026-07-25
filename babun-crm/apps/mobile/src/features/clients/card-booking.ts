// card-booking — one shared «записать» deep-link for every surface on the
// client card (NEXT-JOB hero, ряд действий card-actions, «Обслуживание»
// spine, per-object «Записать сюда»). Navigates to the calendar tab with `new=1` +
// client/location/team; the `?new=` handler in app/(dashboard)/index.tsx
// switches to that client's team calendar (so the new record is visible on
// return) and then pushes the separate /book screen pre-aimed at the client.

import { useRouter } from "expo-router";

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
