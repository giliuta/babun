import { Compass, Map, MapPin, Navigation } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { MapService } from "@babun/shared/common/utils/map-links";
import { createEnabledPrefs } from "@/lib/enabled-prefs";

// КАРТЫ ДЛЯ МАРШРУТА — какие сервисы вообще предлагать (владелец 2026-08-02:
// «если человек пользуется только Google Картами — на фига ему каждый раз
// выбирать Яндекс; это должно быть в настройках, тумблером»).
//
// Отсюда и главное следствие: когда включена ОДНА карта, выбора нет вовсе —
// «Маршрут» открывает её сразу. Лист появляется только там, где выбор
// действительно есть (см. lib/route-menu.ts).

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

export const useEnabledMapServices = prefs.use;
export const useMapServicesOrder = prefs.useOrder;
export const useToggleMapService = prefs.useToggle;
export const useReorderMapServices = prefs.useReorder;
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
