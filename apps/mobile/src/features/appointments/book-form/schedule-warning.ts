import type { Appointment } from "@babun/shared/local/appointments";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import { getDayScheduleForDate, type TeamSchedule } from "@babun/shared/local/schedule";
import { findBufferClash } from "@babun/shared/common/utils/appointment-overlap";
import { effectiveBuffer } from "@/features/calendar/setting-options";
import { draftSlot } from "@/features/appointments/draft-slot";
import { parseYMD } from "@/features/appointments/helpers";
import { absoluteMinutes } from "./book-math";

export interface ScheduleWarningInput {
  editId: string | null;
  teamId: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
  /** The team's weekly schedule; none → company working hours. */
  schedule: TeamSchedule | null | undefined;
  calendarSettings: CalendarSettings | undefined;
  teams: readonly { id: string; buffer_minutes?: number | null }[];
  /** Same team, same day. */
  dayTeamAppts: readonly Appointment[];
}

/** Schedule / break / travel-buffer warning for the draft slot, or null. */
export function scheduleWarning({
  editId,
  teamId,
  date,
  timeStart,
  timeEnd,
  schedule,
  calendarSettings,
  teams,
  dayTeamAppts,
}: ScheduleWarningInput): string | null {
  if (!teamId) return null;
  const startMinutes = absoluteMinutes(timeStart) ?? 0;
  const endMinutes = absoluteMinutes(timeEnd) ?? 0;

  if (schedule) {
    const daySchedule = getDayScheduleForDate(schedule, parseYMD(date));
    if (!daySchedule.is_working) return "У команды нерабочий день";
    const scheduleStart = absoluteMinutes(daySchedule.start);
    const scheduleEnd = absoluteMinutes(daySchedule.end);
    if (
      scheduleStart != null &&
      scheduleEnd != null &&
      (startMinutes < scheduleStart || endMinutes > scheduleEnd)
    ) {
      return `Вне графика команды ${daySchedule.start}–${daySchedule.end}`;
    }
    if (
      daySchedule.breaks.some((pause) => {
        const pauseStart = absoluteMinutes(pause.start);
        const pauseEnd = absoluteMinutes(pause.end);
        return (
          pauseStart != null &&
          pauseEnd != null &&
          startMinutes < pauseEnd &&
          endMinutes > pauseStart
        );
      })
    ) {
      return "Время попадает на перерыв команды";
    }
  } else {
    const scheduleStart = Math.round(
      (calendarSettings?.workStartHour ?? calendarSettings?.startHour ?? 6) *
        60,
    );
    const scheduleEnd = Math.round(
      (calendarSettings?.workEndHour ?? calendarSettings?.endHour ?? 22) *
        60,
    );
    if (startMinutes < scheduleStart || endMinutes > scheduleEnd) {
      return "Вне общих рабочих часов";
    }
  }

  // Буфер команды сильнее компанейского (тот же резолвер, что у сетки):
  // предупреждение «между записями меньше N мин» обязано считать по той
  // команде, на которую записывают.
  const bufferMinutes = effectiveBuffer(
    teams.find((x) => x.id === teamId),
    calendarSettings,
  );
  const tight = findBufferClash(
    draftSlot({ editId, teamId, date, timeStart, timeEnd }),
    dayTeamAppts,
    bufferMinutes,
  );
  return tight && bufferMinutes > 0
    ? `Между записями меньше ${bufferMinutes} мин на дорогу`
    : null;
}
