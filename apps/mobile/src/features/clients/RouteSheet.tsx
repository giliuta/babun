import { useRouter } from "expo-router";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { useClientSettingsDoor } from "@/features/clients/use-settings-door";
import { useEnabledMapServices } from "@/features/clients/map-services";
import { openInMap, routeServices } from "@/features/clients/route-menu";

// ЛИСТ «КУДА ЕХАТЬ» — тот же примитив, что «Добавить» и «Как связаться»
// (выезжает со значками, как лист добавления номера).
//
// Общий `chooseOption` рисовал бы те же строки, но без значков и без входа в
// настройки. Поэтому у каждой карты свой знак и цвет, а шестерёнка ведёт на страницу «Карты для маршрута» — там их включают и
// расставляют порядком.

export function RouteSheet({
  visible,
  target,
  onClose,
  teamId = null,
}: {
  visible: boolean;
  /** Адрес, ссылка или координаты. */
  target: string;
  onClose: () => void;
  /** Команда клиента — её «Карты для маршрута» (у каждой команды свои,
   *  нет — набор компании. */
  teamId?: string | null;
}) {
  const router = useRouter();
  // Шестерёнка — в «Карты для маршрута» ЭТОЙ команды в её компании (из
  // записи — сиблингом записи, см. `useReferenceHref`); строки, закрытой
  // человеку, нет и в листе.
  const settingsHref = useClientSettingsDoor("maps", teamId);
  const enabled = useEnabledMapServices(teamId);

  const items: PickerSheetItem[] = routeServices(enabled).map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    color: s.color,
    onPress: () => openInMap(s.id, target),
  }));

  return (
    <PickerSheet
      visible={visible}
      title="Маршрут"
      items={items}
      onSettings={settingsHref ? () => router.push(settingsHref) : undefined}
      settingsLabel="Карты для маршрута"
      onClose={onClose}
    />
  );
}

export default RouteSheet;
