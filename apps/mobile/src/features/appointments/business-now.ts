import { useCallback } from "react";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { formatHM, formatYMD } from "./helpers";
import type { BusinessNow } from "./payment-draft";

// «СЕЙЧАС» В РАБОЧЕМ ПОЯСЕ КОМПАНИИ — одним помощником для блока «Оплата»
// (визит начался?). Тот же источник, что у сервера: пояс из настроек
// календаря, по умолчанию Кипр. Считать это в двух местах по-разному значит
// закрыть визит в 00:30 «вчера» на одном экране и «сегодня» на другом.

export function businessNowFrom(date: Date): BusinessNow {
  return { ymd: formatYMD(date), hm: formatHM(date) };
}

/** Функция, а не значение: время читают в момент тапа, а не на монтировании.
 *
 *  `teamId` — команда записи: у команды бывает свой пояс, и запись стоит в
 *  ЕЁ часах. Без него лондонская команда кипрского аккаунта в 09:30 по
 *  Лондону (11:30 по Кипру) считала визит в 10:00 начавшимся — тап по счёту
 *  уходил окончательной оплатой и закрывал визит за полчаса до него (аудит
 *  формы записи 03.10). Тот же порядок, что у даты записи:
 *  `team.timezone ?? calendarSettings.timezone`. */
export function useBusinessNow(teamId?: string | null): () => BusinessNow {
  const { data: calendarSettings } = useCalendarSettings();
  const { data: teams } = useTeams({ includeInactive: true });
  const teamZone = teamId ? teams?.find((tm) => tm.id === teamId)?.timezone : null;
  const timezone = teamZone || calendarSettings?.timezone;
  return useCallback(
    () =>
      businessNowFrom(
        timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime(),
      ),
    [timezone],
  );
}
