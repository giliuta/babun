import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import type { TeamSchedule } from "@babun/shared/local/schedule";
import { findOverlap } from "@babun/shared/common/utils/appointment-overlap";
import type { Team } from "@/features/reference/queries";
import { draftSlot } from "@/features/appointments/draft-slot";
import { scheduleWarning } from "./schedule-warning";

export interface SlotWarningsInput {
  allAppts: Appointment[];
  editId: string | null;
  teamId: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
  schedule: TeamSchedule | null | undefined;
  calendarSettings: CalendarSettings | undefined;
  teams: Team[];
}

/** ── пересечение по команде на выбранный день (warn, not block) ── */
export function useSlotWarnings({
  allAppts,
  editId,
  teamId,
  date,
  timeStart,
  timeEnd,
  schedule,
  calendarSettings,
  teams,
}: SlotWarningsInput) {
  const dayTeamAppts = useMemo(
    () =>
      allAppts.filter((a) => a.date === date && a.team_id === teamId),
    [allAppts, date, teamId],
  );
  // ПРЕДУПРЕЖДЕНИЕ — ПРО КОМАНДУ, А НЕ ПРО ЖАНР (сведено 2026-09-10). Обе
  // проверки были жёстко заперты на `kind === "work"`, и командное событие —
  // «выезд в офис» бригадой — не предупреждало ни о двойном бронировании, ни
  // о нерабочем дне: те же люди в то же время, но форма молчала. Личное
  // событие молчит по-прежнему: у него нет команды, с чьим днём столкнуться,
  // и `teamId` там null.
  const overlap = useMemo(() => {
    if (!teamId) return null;
    return findOverlap(
      draftSlot({ editId, teamId, date, timeStart, timeEnd }),
      dayTeamAppts,
    );
  }, [editId, teamId, date, timeStart, timeEnd, dayTeamAppts]);
  const timeWarning = useMemo(
    () =>
      scheduleWarning({
        editId,
        teamId,
        date,
        timeStart,
        timeEnd,
        schedule,
        calendarSettings,
        teams,
        dayTeamAppts,
      }),
    [
      calendarSettings,
      teams,
      date,
      dayTeamAppts,
      editId,
      teamId,
      schedule,
      timeEnd,
      timeStart,
    ],
  );
  return { overlap, timeWarning };
}
