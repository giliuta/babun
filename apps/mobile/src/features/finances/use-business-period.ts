import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getCurrentTimeInZone } from "@babun/shared/common/utils/date-utils";
import type { Period } from "@/lib/period";
import { rebasePeriod } from "./business-period";
import type { BusinessClock } from "./home/use-business-clock";

/** Выбранный период экрана денег, который живёт по календарю компании.
 *
 *  Два события пересобирают пресет (`rebasePeriod`), ручной «Свой период» —
 *  никогда:
 *  - ПРИЕХАЛ ПОЯС. Настроек не было в кэше на монтировании — первый период
 *    построен по запасному поясу и около полуночи мог попасть в чужой месяц.
 *  - СМЕНИЛСЯ ДЕНЬ. «Сегодня», пережившее полночь на открытом экране, — уже
 *    «Вчера», и новая операция падала бы мимо окна. */
export function useBusinessPeriod(
  clock: BusinessClock,
  initial: (now: Date) => Period,
): [Period, Dispatch<SetStateAction<Period>>] {
  const { calendarSettingsQuery, businessTimezone, businessNow, businessToday } = clock;
  const [period, setPeriod] = useState<Period>(() => initial(businessNow));
  const periodTimezoneRef = useRef<string | null>(
    calendarSettingsQuery.isSuccess ? businessTimezone : null,
  );
  useEffect(() => {
    if (!calendarSettingsQuery.isSuccess) return;
    if (periodTimezoneRef.current === businessTimezone) return;
    periodTimezoneRef.current = businessTimezone;
    setPeriod((current) => rebasePeriod(current, getCurrentTimeInZone(businessTimezone)));
  }, [businessTimezone, calendarSettingsQuery.isSuccess]);
  const periodDayRef = useRef(businessToday);
  useEffect(() => {
    if (periodDayRef.current === businessToday) return;
    periodDayRef.current = businessToday;
    setPeriod((current) => rebasePeriod(current, businessNow));
    // `businessNow` — новый объект на каждом кадре; день — его ключ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessToday]);
  return [period, setPeriod];
}
