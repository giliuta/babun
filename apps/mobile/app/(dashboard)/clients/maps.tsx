import { ToggleListScreen } from "@/components/ui/ToggleListScreen";
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
  const order = useMapServicesOrder();
  const enabled = useEnabledMapServices();
  const toggle = useToggleMapService();
  const reorder = useReorderMapServices();

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
      hint="Что предлагать по кнопке «Маршрут»"
      sections={[
        {
          items,
          onReorder: (ids) => reorder.mutate(ids as MapService[]),
          footer: "Если включена одна карта, она откроется сразу — без выбора.",
        },
      ]}
    />
  );
}
