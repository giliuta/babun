import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
import { useLocalSearchParams } from "expo-router";
import type { MapService } from "@babun/shared/common/utils/map-links";
import {
  canDisableMapService,
  mapServiceDef,
  useEnabledMapServices,
  useMapServicesOrder,
  useReorderMapServices,
  useToggleMapService,
} from "@/lib/map-services";

// «Карты для маршрута» — что предлагать по кнопке «Маршрут» и в каком
// порядке (первая в списке — первая в выборе).

export default function ClientMapsScreen() {
  // Набор КОМАНДЫ из адреса (у каждой команды свои настройки клиентов,
  // владелец 30.09); без команды — набор компании.
  const { team } = useLocalSearchParams<{ team?: string }>();
  const teamId = team || null;
  const order = useMapServicesOrder(teamId);
  const enabled = useEnabledMapServices(teamId);
  const toggle = useToggleMapService(teamId);
  const reorder = useReorderMapServices(teamId);

  const items = order
    .map((id) => {
      const def = mapServiceDef(id);
      return def
        ? {
            id: def.id,
            label: def.label,
            icon: def.icon,
            color: def.color,
            checked: enabled.includes(def.id),
            // Снять последнюю нельзя: маршрут перестал бы открываться вовсе.
            locked: !canDisableMapService(enabled, def.id),
            lockedNote: "нужна хотя бы одна",
            onToggle: () => toggle.mutate(def.id),
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <ToggleListScreen
      title="Карты для маршрута"
      sections={[
        { items, onReorder: (ids) => reorder.mutate(ids as MapService[]) },
      ]}
    />
  );
}
