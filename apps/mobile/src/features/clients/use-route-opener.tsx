import { useState } from "react";
import { RouteSheet } from "@/features/clients/RouteSheet";
import { useEnabledMapServices } from "@/lib/map-services";
import { directRouteUrl, openDirect, routeTarget } from "@/lib/route-menu";
import { haptics } from "@/lib/haptics";

// «МАРШРУТ» СТРОКОЙ — ТА ЖЕ ШТОРКА КАРТ, ЧТО У КНОПКИ ОБЪЕКТА
// (`ObjectRouteButton`), для мест, где маршрут — целая строка, а не кнопка в
// хвосте. Лист выезда партнёра и лист события открывали Apple Карты в
// браузере напрямую: мимо «Карт для маршрута» команды, мимо присланного
// клиентом пина и с веб-страницей на Android (аудит формы записи 03.10).
//
// `open` решает, нужен ли выбор: одна карта или присланная ссылка — сразу,
// иначе — лист; `sheet` рендерится рядом со строкой.
export function useRouteOpener(teamId: string | null) {
  const enabled = useEnabledMapServices(teamId);
  const [target, setTarget] = useState<string | null>(null);
  const open = (mapUrl: string | null | undefined, address: string | null | undefined) => {
    const next = routeTarget(mapUrl, address);
    if (!next) return;
    const direct = directRouteUrl(next, enabled);
    if (direct) {
      openDirect(direct);
      return;
    }
    haptics.tap();
    setTarget(next);
  };
  const sheet = (
    <RouteSheet
      visible={target !== null}
      target={target ?? ""}
      teamId={teamId}
      onClose={() => setTarget(null)}
    />
  );
  return { open, sheet };
}
