import { Navigation } from "lucide-react-native";
import { RowActionButton } from "@/features/clients/card-rows";
import { openRouteMenu, routeTarget } from "@/lib/route-menu";
import { useThemeColors } from "@/theme/colors";

// КНОПКА МАРШРУТА У КОНКРЕТНОГО АДРЕСА — тот же приём, что кнопка связи у
// конкретного номера: маленькая кнопка в хвосте строки, тап — нативный выбор
// карты (владелец 2026-07-26: «нажимаешь кнопку и выбираешь, что делать»).
//
// Берёт цель, а не объект: на странице объекта в режиме создания объекта ещё
// нет, а адрес в черновике уже есть — и маршрут по нему должен работать.
//
// Ни пина, ни адреса — кнопки нет вовсе: мёртвых контролов не держим.

export default function ObjectRouteButton({
  mapUrl,
  address,
  label,
}: {
  mapUrl?: string | null;
  address?: string | null;
  /** Для озвучки: «Маршрут · Дом». */
  label?: string | null;
}) {
  const t = useThemeColors();
  const target = routeTarget(mapUrl, address);
  if (!target) return null;
  return (
    <RowActionButton
      icon={Navigation}
      color={t.accent}
      label={label ? `Маршрут · ${label}` : "Маршрут"}
      hint="Выбор карты для маршрута"
      onPress={() => openRouteMenu(target)}
    />
  );
}
