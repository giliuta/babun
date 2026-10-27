import type { Appointment } from "@babun/shared/local/appointments";
import { buildMapUrl, type MapService } from "@babun/shared/common/utils/map-links";

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

/** МАРШРУТ ДНЯ В КАРТЕ КОМАНДЫ («Карты для маршрута»). Через все адреса
 *  умеют Google (точки пути) и Яндекс (`rtext` — от «я здесь» через все
 *  точки). Apple Карты и Waze ссылкой ведут только к одной точке — к первому
 *  выезду дня: туда и едут первым, а маршрут через все точки там не собрать. */
export function dayRouteUrlFor(service: MapService, addresses: string[]): string | null {
  if (addresses.length === 0) return null;
  if (service === "google") return dayRouteUrl(addresses);
  if (service === "yandex") {
    return `https://yandex.ru/maps/?rtext=~${addresses
      .map((a) => encodeURIComponent(a))
      .join("~")}&rtt=auto`;
  }
  return buildMapUrl(service, addresses[0]);
}

/** Чьи «Карты для маршрута» открывают день: команда первого выезда. В ленте
 *  одного календаря это и есть его команда. */
export function dayRouteTeamId(data: Appointment[]): string | null {
  return data.find((a) => a.kind === "work" && a.status !== "cancelled" && a.team_id)?.team_id ?? null;
}
