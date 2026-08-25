import { useState } from "react";
import { Navigation } from "lucide-react-native";
import { RowActionButton } from "@/components/ui/card-rows";
import { RouteSheet } from "@/features/clients/RouteSheet";
import { useEnabledMapServices } from "@/lib/map-services";
import { directRouteUrl, openDirect, routeTarget } from "@/lib/route-menu";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// КНОПКА МАРШРУТА У КОНКРЕТНОГО АДРЕСА — тот же приём, что кнопка связи у
// конкретного номера: маленькая кнопка в хвосте строки, тап — лист со
// значками карт (владелец 2026-08-06: «то же самое, как добавить номер»).
//
// Берёт цель, а не объект: на экране записи объекта ещё может не быть, а
// адрес в черновике уже есть — и маршрут по нему должен работать.
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
  const enabled = useEnabledMapServices();
  const [open, setOpen] = useState(false);
  const target = routeTarget(mapUrl, address);
  if (!target) return null;

  return (
    <>
      <RowActionButton
        icon={Navigation}
        color={t.accent}
        label={label ? `Маршрут · ${label}` : "Маршрут"}
        hint="Выбор карты для маршрута"
        onPress={() => {
          // Выбирать не из чего (одна карта или присланная ссылка) — везём
          // сразу, без лишнего тапа на каждом выезде.
          const direct = directRouteUrl(target, enabled);
          if (direct) {
            openDirect(direct);
            return;
          }
          haptics.tap();
          setOpen(true);
        }}
      />
      <RouteSheet
        visible={open}
        target={target}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
