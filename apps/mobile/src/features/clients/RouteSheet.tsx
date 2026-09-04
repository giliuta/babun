import { useRouter } from "expo-router";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useEnabledMapServices } from "@/lib/map-services";
import { openInMap, routeServices } from "@/lib/route-menu";

// ЛИСТ «КУДА ЕХАТЬ» — тот же примитив, что «Добавить» и «Как связаться»
// (владелец 2026-08-06: «чтобы выглядело так же, как когда нажимаю добавить
// номер телефона — красиво выезжает со значками»).
//
// Раньше выбор карты рисовал общий `chooseOption`: те же строки, но без
// значков и без входа в настройки. Теперь у каждой карты свой знак и цвет, а
// шестерёнка ведёт на страницу «Карты для маршрута» — там их включают и
// расставляют порядком.

export function RouteSheet({
  visible,
  target,
  onClose,
}: {
  visible: boolean;
  /** Адрес, ссылка или координаты. */
  target: string;
  onClose: () => void;
}) {
  const router = useRouter();
  // Из записи справочник открывается её сиблингом (см. `useReferenceHref`).
  const mapsHref = useReferenceHref().maps;
  const enabled = useEnabledMapServices();

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
      onSettings={() => router.push(mapsHref)}
      settingsLabel="Карты для маршрута"
      onClose={onClose}
    />
  );
}

export default RouteSheet;
