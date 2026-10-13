import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { CalendarRoute } from "./use-calendar-route";

type UseGridModesDeps =
  Pick<CalendarRoute, "router" | "params" | "tenantId">;

/** Grid modes that change what a tap on time does: pick a time for a
 *  client, move or copy onto green slots, free move. They end on
 *  leaving the screen and on a company switch. */
export function useGridModes(deps: UseGridModesDeps) {
  const { router, params, tenantId } = deps;
  // РЕЖИМ ПЕРЕНОСА — запись, для которой сетка показывает зелёные кубики
  // (владелец 2026-09-06: «нажимаю Перенести — и кубики появляются зелёные,
  // куда можно перевести по всей таблице»). null = обычный календарь.
  const [moving, setMoving] = useState<Appointment | null>(null);
  // «ПЕРЕНЕСТИ» И «КОПИРОВАТЬ» — ОДИН РЕЖИМ ЗЕЛЁНЫХ КУБИКОВ (владелец 24.09:
  // «копирую на команде Y&D, переношу в Команду 1… качественное и удобное
  // управление»). Разница только в том, что делает тап по кубику: запись
  // уезжает целиком или туда встаёт её копия. Раньше «Копировать» сразу
  // клал дубль ПОВЕРХ оригинала и открывал форму — куда вставить, приходилось
  // править руками.
  const [movingKind, setMovingKind] = useState<"move" | "copy">("move");
  /** Запись, по которой уже тапнули кубик в этом режиме, — второй тап до
   *  перерисовки её не ставит ещё раз. Ref: ответ нужен в том же кадре. */
  const placedFromRef = useRef<Appointment | null>(null);
  // РЕЖИМ ПРАВКИ ЗАПИСИ («Двигать и растягивать»). В покое запись закреплена
  // (владелец 2026-09-24: «просто так тянуть нельзя — зажимаешь, открывается
  // окно, выбрал — тогда можно»). В режиме у неё ручки сверху и снизу, сетка
  // не прокручивается, палец двигает запись и тянет края.
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);

  // РЕЖИМ — СОСТОЯНИЕ ЭКРАНА, А НЕ АДРЕС. Параметр вкладки переживает всё:
  // и уход в форму, и переключение табов — плашка «Записать: Иван» висела
  // после сохранения (того же человека можно было записать второй раз) и
  // встречала при возврате из «Клиентов». Параметр теперь только ДОСТАВЛЯЕТ
  // задание: приняли — и сразу стёрли адрес, дальше режимом владеет экран.
  const [pick, setPick] = useState<{
    clientId: string;
    locationId: string | null;
    teamId: string | null;
  } | null>(null);
  const pickClientId = pick?.clientId ?? null;
  useEffect(() => {
    if (!params.pickClient) return;
    setPick({
      clientId: params.pickClient,
      locationId: params.pickLocation || null,
      teamId: params.pickTeam || null,
    });
    router.setParams({
      pickClient: "",
      pickLocation: "",
      pickTeam: "",
    });
  }, [
    params.pickClient,
    params.pickLocation,
    params.pickTeam,
    router,
  ]);
  // Уход с календаря снимает вопросы «когда?» и «куда?»: они заданы один раз.
  // И «Свободное перемещение» тоже (аудит 03.10): плашка висела после
  // возвращения, а сетка оставалась в режиме правки.
  useFocusEffect(
    useCallback(
      () => () => {
        setPick(null);
        setMoving(null);
        setEditingApt(null);
      },
      [],
    ),
  );

  // Смена компании снимает и «Записать: клиент» (аудит 03.10): плашка с
  // чужим клиентом переживала переход, форма открывалась без клиента.
  // Именно СМЕНА: на монтировании эффект шёл следом за приёмом параметров
  // выше и стирал только что принятое «Записать» — экран, открытый ссылкой
  // сразу с заданием, его терял (повторный аудит 03.10).
  const clearedForTenantRef = useRef(tenantId);
  useEffect(() => {
    if (clearedForTenantRef.current === tenantId) return;
    clearedForTenantRef.current = tenantId;
    setMoving(null);
    setEditingApt(null);
    setPick(null);
  }, [tenantId]);

  return {
    pick, setPick, pickClientId, moving, setMoving, movingKind, setMovingKind,
    placedFromRef, editingApt, setEditingApt,
  };
}

export type GridModes = ReturnType<typeof useGridModes>;
