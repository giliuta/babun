import type { Appointment } from "@babun/shared/local/appointments";

// Beta #54 — maps deep-link with the day's addresses as waypoints, in
// visit order (web AgendaView). No route optimization (paid quota) — the
// dispatcher just gets every address pinned in order.
// МАРШРУТ — ТОЛЬКО ПО ВЫЕЗДАМ: отменённый визит и
// событие в него не входят, а адрес — как у блока сетки, с адресом клиента
// вместо пустого снимка; иначе мастера везло на отменённый визит, а
// старые записи без снимка из маршрута выпадали.
export function dayRouteAddresses(
  data: Appointment[],
  addressFor?: (a: Appointment) => string | null,
): string[] {
  return Array.from(
    new Set(
      data
        .filter((a) => a.kind === "work" && a.status !== "cancelled")
        .map((a) => (addressFor?.(a) ?? a.address ?? "").trim())
        .filter(Boolean),
    ),
  );
}

/** Google Maps directions through every address, in visit order. */
export function dayRouteUrl(addresses: string[]): string | null {
  return addresses.length > 0
    ? `https://www.google.com/maps/dir/${addresses
        .map((a) => encodeURIComponent(a))
        .join("/")}`
    : null;
}
