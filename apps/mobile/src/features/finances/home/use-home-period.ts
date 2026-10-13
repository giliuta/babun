import { useEffect, useRef, useState } from "react";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { defaultPeriod, makePeriod, type Period } from "../period";
import type { BusinessClock } from "./use-business-clock";

/** Selected period of the screen plus the open-state of its two pickers. */
export function useHomePeriod(clock: BusinessClock) {
  const {
    calendarSettingsQuery,
    calendarSettings,
    businessTimezone,
    businessNow,
    businessToday,
  } = clock;
  const periodTimezoneRef = useRef<string | null>(
    calendarSettingsQuery.isSuccess ? businessTimezone : null,
  );
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(businessNow));
  // If settings were not cached at mount, the initial fallback may belong to
  // another month around midnight. Rebase preset ranges once the tenant's
  // timezone arrives; a hand-picked custom range is never overwritten.
  useEffect(() => {
    if (!calendarSettingsQuery.isSuccess) return;
    if (periodTimezoneRef.current === businessTimezone) return;
    setPeriod((current) =>
      current.preset === "custom"
        ? current
        : makePeriod(
            current.preset,
            getCurrentTimeInZone(businessTimezone),
          ),
    );
    periodTimezoneRef.current = businessTimezone;
  }, [businessTimezone, calendarSettingsQuery.isSuccess]);
  // Пресет живёт по календарю компании: «Сегодня», пережившее полночь на
  // смонтированной вкладке, — уже «Вчера», и новая операция падала бы мимо
  // окна ленты. Смена бизнес-дня пересобирает диапазон той же механикой, что
  // и приезд таймзоны выше; ручной «Свой период» не трогаем.
  const periodDayRef = useRef(businessToday);
  useEffect(() => {
    if (periodDayRef.current === businessToday) return;
    periodDayRef.current = businessToday;
    const now = calendarSettings?.timezone
      ? getCurrentTimeInZone(businessTimezone)
      : getCurrentCyprusTime();
    setPeriod((current) =>
      current.preset === "custom" ? current : makePeriod(current.preset, now),
    );
  }, [businessToday, businessTimezone, calendarSettings?.timezone]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  return { period, setPeriod, presetOpen, setPresetOpen, wheelsOpen, setWheelsOpen };
}
