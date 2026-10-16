import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { addDays, startOfDay } from "./dates";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { CalendarView } from "./use-calendar-view";

type UseCalendarClockDeps =
  Pick<CalendarScope, "activeTeam">
  & Pick<CalendarSources, "calSettings" | "teamsPending" | "calSettingsQuery">
  & Pick<CalendarView, "day" | "setDay">;

/** Business-time "now" for the grid, and the one-time re-anchor of the
 *  start day to the business "today". */
export function useCalendarClock(deps: UseCalendarClockDeps) {
  const { activeTeam, calSettings, day, setDay, teamsPending, calSettingsQuery } = deps;
  // «Сегодня» устройства может отличаться от бизнес-таймзоны команды (ночь
  // у владельца ≠ ночь команды): пока пользователь не тронул дату, один раз
  // перепривязываем якорь к бизнес-сегодня, как только таймзона резолвится.
  const seedYmdRef = useRef<string | null>(null);
  // «Now» in the BUSINESS timezone, ticked every minute so the now-line /
  // past-wash / isToday stay live while the screen is open — including
  // across midnight. Per-brigade timezone wins over the global setting
  // (web parity: activeBrigadeTimezone, dashboard/page.tsx:752-756).
  const timezone = activeTeam?.timezone ?? calSettings?.timezone;
  const readNow = useCallback(
    () => (timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime()),
    [timezone],
  );
  const [now, setNow] = useState(readNow);
  // ЧАСЫ — ПО СМЕНЕ МИНУТЫ И ПО ВОЗВРАТУ ИЗ ФОНА.
  // Интервал в 60 с от открытия экрана отставал от часов телефона до минуты
  // (на сетке «17:48» при 17:49 в статус-баре), а в фоне таймеры JS стоят:
  // открыл утром — до минуты «сегодня» оставалось вчерашним, со вчерашними
  // «не закрыта» и метками. Тик — к началу следующей минуты, и сразу при
  // возвращении приложения.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      setNow(readNow());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    tick();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [readNow]);
  const todayYmd = formatYMD(now);
  const tomorrowYmd = formatYMD(addDays(now, 1));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  /** «Сейчас» по времени бизнеса строкой — шторке дня и месяцу для долга. */
  const nowHmBusiness = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Перепривязка стартового дня к бизнес-сегодня (см. seedYmdRef выше).
  // Ждём, пока таймзона резолвится (todayYmd разойдётся с сидом), но
  // отключаемся навсегда, как только пользователь сам ушёл с сида.
  if (seedYmdRef.current === null) seedYmdRef.current = formatYMD(day);
  useEffect(() => {
    const seed = seedYmdRef.current;
    if (!seed) return;
    if (formatYMD(day) !== seed) {
      seedYmdRef.current = "";
      return;
    }
    // ПОКА ПОЯС НЕ ИЗВЕСТЕН, «СЕГОДНЯ» — КИПРСКОЕ, И ПЕРЕПРИВЯЗКА ЖДЁТ.
    // Срабатывая по нему, она выключалась навсегда:
    // у компании в Берлине в 23:30 календарь вставал на ЗАВТРА по Кипру и
    // уже не возвращался, когда пояс приезжал.
    // Пояс календаря — у его команды, иначе общий: ждём обоих ответов.
    if (teamsPending || calSettingsQuery.isPending) return;
    if (todayYmd !== seed) {
      seedYmdRef.current = "";
      setDay(startOfDay(parseYMD(todayYmd)));
    }
  }, [todayYmd, day, teamsPending, calSettingsQuery.isPending, setDay]);

  return {
    now, todayYmd, tomorrowYmd, nowMinutes, nowHmBusiness,
  };
}

export type CalendarClock = ReturnType<typeof useCalendarClock>;
