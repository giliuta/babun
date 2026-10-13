import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { formatHM } from "@/features/appointments/helpers";
import { todayYmd } from "@/features/invoices/format";
import { useCalendarSettings } from "@/features/settings/local-settings";

/** The company's clock: its timezone, "now", today (YYYY-MM-DD) and HH:MM. */
export function useBusinessClock() {
  const calendarSettingsQuery = useCalendarSettings();
  const calendarSettings = calendarSettingsQuery.data;
  const businessTimezone = calendarSettings?.timezone ?? "Europe/Nicosia";
  const businessNow = calendarSettings?.timezone
    ? getCurrentTimeInZone(businessTimezone)
    : getCurrentCyprusTime();
  const businessToday = todayYmd(businessTimezone);
  const businessNowHm = formatHM(businessNow);
  return {
    calendarSettingsQuery,
    calendarSettings,
    businessTimezone,
    businessNow,
    businessToday,
    businessNowHm,
  };
}

export type BusinessClock = ReturnType<typeof useBusinessClock>;
