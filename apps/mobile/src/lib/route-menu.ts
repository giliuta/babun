import { Linking } from "react-native";
import {
  buildMapUrl,
  parseAddress,
  type MapService,
} from "@babun/shared/common/utils/map-links";
import { haptics } from "@/lib/haptics";
import { MAP_SERVICES } from "@/lib/map-services";

// «МАРШРУТ» — один выбор карты на весь продукт: экран записи и строка объекта.
//
// Выбор нужен потому, что у одних диспетчеров пробки в Google, у других
// CarPlay с Apple Картами, и навязывать одну карту нельзя. Рисует его лист
// `RouteSheet` — тот же `PickerSheet` со значками, что «Добавить» и «Как
// связаться» (владелец 2026-08-06: «чтобы это выглядело так же, как когда
// нажимаю добавить номер телефона — красиво выезжает со значками»).
//
// Здесь остаётся только РЕШЕНИЕ, нужен ли выбор вообще: лист из одного пункта
// был бы лишним тапом на каждом выезде.
//
// Приоритет цели: присланный клиентом пин (Location.mapUrl) выше текстового
// адреса — на кипрских виллах текстовый адрес часто не прокладывается.

/** Что открывать: пин важнее текста. Пустая строка → маршрута нет. */
export function routeTarget(
  mapUrl: string | null | undefined,
  address: string | null | undefined,
): string {
  return (mapUrl || "").trim() || (address || "").trim();
}

/** Карты, которые реально предлагаем, В ПОРЯДКЕ ПОЛЬЗОВАТЕЛЯ.
 *  Идём по `enabled` (он уже отсортирован настройкой), а не по константе:
 *  иначе перетаскивание на странице «Карты для маршрута» ничего не меняло бы
 *  в листе — ручка есть, подпись обещает порядок, а лист рисует своё. */
export function routeServices(enabled: MapService[]) {
  return enabled
    .map((id) => MAP_SERVICES.find((s) => s.id === id))
    .filter((s): s is (typeof MAP_SERVICES)[number] => s !== undefined);
}

/** URL, который надо открыть БЕЗ выбора, или null — если выбор нужен.
 *
 *  Присланная ссылка без координат (короткая maps.app.goo.gl и подобные) —
 *  НЕ выбор: Apple Картам такую ссылку можно отдать только текстовым запросом
 *  `?q=https%3A%2F%2F…`, и они честно ищут «https://…» вместо адреса. Ссылку
 *  открываем как есть — её разберёт то приложение, которое её понимает. */
export function directRouteUrl(
  target: string,
  enabled: MapService[],
): string | null {
  const clean = target.trim();
  if (!clean) return null;
  const parsed = parseAddress(clean);
  if (parsed.isUrl && !parsed.coords) {
    return clean.startsWith("http") ? clean : `https://${clean}`;
  }
  const services = routeServices(enabled);
  if (services.length === 1) return buildMapUrl(services[0].id, clean);
  return null;
}

/** Открыть цель в выбранной карте. */
export function openInMap(service: MapService, target: string): void {
  const url = buildMapUrl(service, target.trim());
  if (!url) return;
  haptics.tap();
  void Linking.openURL(url);
}

export function openDirect(url: string): void {
  haptics.tap();
  void Linking.openURL(url);
}
