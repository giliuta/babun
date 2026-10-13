import { useEffect, useState } from "react";
import type { CalendarRoute } from "./use-calendar-route";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarView } from "./use-calendar-view";

/** Сколько живёт плашка «время прошло / нерабочее — всё равно записать?»:
 *  ровно столько убывает её полоска. */
export const NOTICE_LIFETIME_MS = 5000;

type UseSlotNoticeDeps =
  Pick<CalendarScope, "activeTeamId">
  & Pick<CalendarView, "mode">
  & Pick<CalendarRoute, "tenantId">;

/** The past / off-hours slot notice over the header: its state, lifetime
 *  and reset. */
export function useSlotNotice(deps: UseSlotNoticeDeps) {
  const { activeTeamId, mode, tenantId } = deps;
  /** Вопрос, накрывший шапку: «время нерабочее / уже прошло — всё равно?» */
  const [notice, setNotice] = useState<{
    /** Новый тап — новая плашка: время на ней сменилось, срок начинается
     *  заново (владелец 13.10: «если тапаю ещё раз — время обновляется»). */
    id: number;
    /** Какое время тапнули: «7 октября, 13:00». */
    when: string;
    message: string;
    onAction: () => void;
  } | null>(null);
  // «Временно перекрывает» — значит уходит сама. Пять секунд: столько живёт
  // тост с кнопкой, и месяц с переключателем вида не должны быть закрыты
  // дольше, чем человек читает одну строку.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  // Вопрос задан про КОНКРЕТНУЮ сетку: чужая команда, другой вид или
  // компания — и «Записать» открывал бы слот, чью причину считали по графику
  // прежней команды (повторный аудит 03.10). Смена — вопрос снимается.
  useEffect(() => {
    setNotice(null);
  }, [activeTeamId, mode, tenantId]);

  return {
    notice, setNotice,
  };
}

export type SlotNotice = ReturnType<typeof useSlotNotice>;
