import { useCallback } from "react";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { formatHM, formatYMD } from "./helpers";
import type { BusinessNow } from "./payment-draft";

// «СЕЙЧАС» В РАБОЧЕМ ПОЯСЕ КОМПАНИИ — одним помощником для блока «Оплата»
// (визит начался?) и «Незакрытых» (день прошёл?). Тот же источник, что у
// сервера: пояс из настроек календаря, по умолчанию Кипр. Считать это в двух
// местах по-разному значит закрыть визит в 00:30 «вчера» на одном экране и
// «сегодня» на другом.

export function businessNowFrom(date: Date): BusinessNow {
  return { ymd: formatYMD(date), hm: formatHM(date) };
}

/** Функция, а не значение: время читают в момент тапа, а не на монтировании. */
export function useBusinessNow(): () => BusinessNow {
  const { data: calendarSettings } = useCalendarSettings();
  const timezone = calendarSettings?.timezone;
  return useCallback(
    () =>
      businessNowFrom(
        timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime(),
      ),
    [timezone],
  );
}
