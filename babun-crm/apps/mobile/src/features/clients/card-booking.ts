// card-booking — one shared «записать» deep-link for every surface on the
// client card (NEXT-JOB hero, 5-action row, «Обслуживание» spine, per-object
// «Записать сюда»). Mirrors the web buildBookingHref: navigate to the
// calendar tab with `new=1` + client/location/team so the booking sheet
// opens pre-aimed at this client — the `?new=` handler in
// app/(dashboard)/index.tsx reads all three and pre-selects the object.

import { useRouter } from "expo-router";

export interface BookingTarget {
  clientId: string;
  locationId?: string | null;
  teamId?: string | null;
}

/** Returns a stable-enough callback that opens the calendar pre-aimed at
 *  the given client/object/team. */
export function useBookingNav(): (target: BookingTarget) => void {
  const router = useRouter();
  return ({ clientId, locationId, teamId }: BookingTarget) =>
    router.push({
      pathname: "/(dashboard)",
      params: {
        new: "1",
        clientId,
        ...(locationId ? { locationId } : {}),
        ...(teamId ? { teamId } : {}),
      },
    });
}
