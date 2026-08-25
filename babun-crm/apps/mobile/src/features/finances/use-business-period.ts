// ПЕРИОД ПО ЧАСАМ КОМПАНИИ — ОДИН КОНТРОЛ И ОДНА ЛОВУШКА НА ДЕНЕЖНЫЕ ЭКРАНЫ
// С ПЕРИОДОМ. Сегодня это карточка счёта: список счетов период потерял
// 2026-08-11, а главный экран «Финансы» несёт копию этой же логики — при его
// дедупликации переводить сюда, а не заводить третий вариант.
//
// Ловушка одна и та же: часовой пояс тенанта приезжает ПОСЛЕ первого кадра,
// а пресет «текущий месяц» считается сразу. Около полуночи (и всегда, если
// телефон живёт в другом поясе) первый кадр показывал чужой месяц, и человек
// читал деньги не за тот период. Поэтому пресет пересобирается ровно один
// раз — когда пояс стал известен, — и ТОЛЬКО пресет: произвольный период,
// выбранный руками, не трогается никогда.

import { useEffect, useRef, useState } from "react";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";
import { defaultPeriod, makePeriod, type Period } from "./period";

export interface BusinessPeriod {
  /** Сегодня по часам компании, YYYY-MM-DD. */
  businessToday: string;
  /** Сейчас по часам компании — база для пресетов периода. */
  businessNow: Date;
  period: Period;
  setPeriod: (next: Period) => void;
}

export function useBusinessPeriod(): BusinessPeriod {
  const calendarSettings = useCalendarSettings();
  const timezone = calendarSettings.data?.timezone ?? "Europe/Nicosia";
  const businessNow = calendarSettings.data?.timezone
    ? getCurrentTimeInZone(timezone)
    : getCurrentCyprusTime();
  const businessToday = todayYmd(timezone);

  const [period, setPeriod] = useState<Period>(() => defaultPeriod(businessNow));
  const appliedTimezone = useRef<string | null>(
    calendarSettings.isSuccess ? timezone : null,
  );
  useEffect(() => {
    if (!calendarSettings.isSuccess) return;
    if (appliedTimezone.current === timezone) return;
    appliedTimezone.current = timezone;
    setPeriod((current) =>
      current.preset === "custom"
        ? current
        : makePeriod(current.preset, getCurrentTimeInZone(timezone)),
    );
  }, [timezone, calendarSettings.isSuccess]);

  return { businessToday, businessNow, period, setPeriod };
}
