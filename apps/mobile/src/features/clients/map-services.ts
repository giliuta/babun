import { Platform } from "react-native";
import { Compass, Map, MapPin, Navigation } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { MapService } from "@babun/shared/common/utils/map-links";
import { createEnabledPrefs } from "@/lib/enabled-prefs";
import { teamOrderedSet } from "@/features/clients/team-ordered-set";

// КАРТЫ ДЛЯ МАРШРУТА — какие сервисы вообще предлагать: тому, кто пользуется
// только Google Картами, незачем каждый раз выбирать Яндекс; это настройка
// тумблером.
//
// Отсюда и главное следствие: когда включена ОДНА карта, выбора нет вовсе —
// «Маршрут» открывает её сразу. Лист появляется только там, где выбор
// действительно есть (см. features/clients/route-menu.ts).

export interface MapServiceDef {
  id: MapService;
  label: string;
  /** Значок в листе — тот же приём, что у способов связи. */
  icon: LucideIcon;
  color: string;
}

/** Порядок = порядок в листе маршрута и в настройках. */
export const MAP_SERVICES: MapServiceDef[] = [
  { id: "google", label: "Google Карты", icon: MapPin, color: "#1a73e8" },
  { id: "apple", label: "Apple Карты", icon: Map, color: "#3d4b5c" },
  { id: "waze", label: "Waze", icon: Navigation, color: "#0e8f9e" },
  { id: "yandex", label: "Яндекс Карты", icon: Compass, color: "#c62828" },
];

const prefs = createEnabledPrefs<MapService>({
  storageKey: "babun-map-services",
  queryKey: "map-services",
  all: MAP_SERVICES.map((s) => s.id),
  // По умолчанию — все четыре: до первой настройки поведение прежнее.
  defaults: MAP_SERVICES.map((s) => s.id),
  // Снять последнюю карту нельзя: маршрут перестал бы открываться вовсе.
  requireOne: true,
});

// Набор команды — на сервере (`team_design.map_services`), телефон —
// запасной, пока команда на сервере не настраивала.
const teamSet = teamOrderedSet(prefs, "mapServices");

/** Apple Карты есть только на технике Apple: на Android их ссылка уходит в
 *  браузер, а не в приложение карт. Набор команды общий для всех телефонов,
 *  поэтому Apple в нём остаётся (её выбрали люди с iPhone) — Android просто
 *  её не предлагает, а если в наборе была только она, маршрут ведёт Google. */
const OFFERED_HERE = (id: MapService) => Platform.OS !== "android" || id !== "apple";

export function useEnabledMapServices(teamId: string | null = null): MapService[] {
  const enabled = teamSet.use(teamId);
  const here = enabled.filter(OFFERED_HERE);
  return here.length > 0 || enabled.length === 0 ? here : ["google"];
}
export const useMapServicesOrder = teamSet.useOrder;
export const useToggleMapService = teamSet.useToggle;
export const useReorderMapServices = teamSet.useReorder;
export const canDisableMapService = prefs.canDisable;

/** Определение карты по id — списки ходят по ПОРЯДКУ ПОЛЬЗОВАТЕЛЯ. */
export function mapServiceDef(id: MapService): MapServiceDef | undefined {
  return MAP_SERVICES.find((m) => m.id === id);
}

/** Подпись строки настроек: «Google Карты · Waze» — в порядке пользователя. */
export function mapServicesSummary(enabled: MapService[]): string {
  return enabled
    .map((id) => mapServiceDef(id)?.label)
    .filter(Boolean)
    .join(" · ");
}
