import {
  getDayScheduleForDate,
  type TeamSchedule,
} from "@babun/shared/local/schedule";
import { parseYMD } from "@/features/appointments/helpers";
import type { WorkBand } from "@/features/calendar/DayView";
import { parseHourHM } from "./dates";

/** null = day off, undefined = no usable schedule (caller falls back). */
type WorkBandFor = (dateYmd: string) => WorkBand | null | undefined;

/** Per-date working band of a team schedule; undefined while there is no
 *  schedule at all. */
export function workBandResolver(
  teamSchedule: TeamSchedule | null | undefined,
): WorkBandFor | undefined {
  if (!teamSchedule) return undefined;
  return (dateYmd: string): WorkBand | null | undefined => {
    const sched = getDayScheduleForDate(teamSchedule, parseYMD(dateYmd));
    if (!sched.is_working) return null;
    const start = parseHourHM(sched.start);
    const end = parseHourHM(sched.end);
    if (start == null || end == null || end <= start) return undefined;
    // Перерывы команды (обед и т.п.) — серые полосы на сетке, чтобы
    // диспетчер не записывал клиента на обед (web DayColumn breaks).
    const breaks = sched.breaks
      .map((b) => {
        const bs = parseHourHM(b.start);
        const be = parseHourHM(b.end);
        return bs != null && be != null && be > bs
          ? { startMin: Math.round(bs * 60), endMin: Math.round(be * 60) }
          : null;
      })
      .filter((b): b is { startMin: number; endMin: number } => b !== null);
    return {
      startMin: Math.round(start * 60),
      endMin: Math.round(end * 60),
      breaks,
    };
  };
}
