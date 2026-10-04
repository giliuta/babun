// Per-team work schedule. Shape only — хранит его Supabase через
// db/repositories/schedule.ts.
//
// Each team has a "general" schedule that applies to all days, plus
// optional per-weekday overrides with multiple breaks per day.

export interface ScheduleBreak {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface DaySchedule {
  is_working: boolean;
  start: string;
  end: string;
  breaks: ScheduleBreak[];
}

export interface TeamSchedule {
  start: string; // general start (legacy field, still used for auto-scroll)
  end: string; // general end
  breaks?: ScheduleBreak[];
  // Per-weekday overrides. Keys: "mon","tue","wed","thu","fri","sat","sun".
  // If a key is missing, the general schedule applies.
  overrides?: Partial<Record<WeekdayKey, DaySchedule>>;
  // Date-specific overrides (YYYY-MM-DD → DaySchedule). Take precedence
  // over weekday overrides. Used for vacations, special events, day-off
  // swaps — Bumpix's "Режим особого расписания".
  date_overrides?: Record<string, DaySchedule>;
  /** Sprint 033 Phase I28 — named date-range blackouts. Each entry
   *  marks every date in [start..end] inclusive as non-working,
   *  regardless of weekday overrides. Displayed as a clean list in
   *  the schedule editor. */
  vacations?: VacationRange[];
}

export interface VacationRange {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  reason?: string;
}

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAY_KEYS: WeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_NAMES: Record<WeekdayKey, string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

export const DEFAULT_SCHEDULE: TeamSchedule = {
  start: "08:00",
  end: "22:00",
  breaks: [],
};

export type ScheduleMap = Record<string, TeamSchedule>;

/** Returns the DaySchedule applicable to a given JS Date (0=Sunday). */
export function getDaySchedule(
  schedule: TeamSchedule,
  jsDay: number
): DaySchedule {
  const mapJs: Record<number, WeekdayKey> = {
    0: "sun",
    1: "mon",
    2: "tue",
    3: "wed",
    4: "thu",
    5: "fri",
    6: "sat",
  };
  const key = mapJs[jsDay];
  const override = schedule.overrides?.[key];
  if (override) return override;
  return {
    is_working: true,
    start: schedule.start,
    end: schedule.end,
    breaks: schedule.breaks ?? [],
  };
}

/**
 * Date-aware resolver. Date-level overrides beat weekday overrides.
 * Use this when the caller knows the exact calendar date — the plain
 * getDaySchedule(schedule, jsDay) kept as-is for callers that only
 * know the weekday.
 */
export function getDayScheduleForDate(
  schedule: TeamSchedule,
  date: Date
): DaySchedule {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}-${mm}-${dd}`;
  // Precision order: the explicit date override beats a vacation RANGE —
  // «в эту дату так» is the sharper statement of intent, and the mobile
  // special-day editor writes overrides, so a vacation that silently
  // outranked them would make that editor a liar (toggle "рабочий день"
  // on, grid stays grey). Flipped from vacation-first 2026-08-15; prod
  // had zero overrides and zero vacations, so no stored data changed
  // meaning.
  const dayOverride = schedule.date_overrides?.[dateKey];
  if (dayOverride) return dayOverride;
  if (isInVacation(schedule, dateKey)) {
    return {
      is_working: false,
      start: schedule.start,
      end: schedule.end,
      breaks: [],
    };
  }
  return getDaySchedule(schedule, date.getDay());
}

/** Check if a YYYY-MM-DD key falls inside ANY vacation range. */
function isInVacation(
  schedule: TeamSchedule,
  dateKey: string,
): boolean {
  const list = schedule.vacations ?? [];
  for (const v of list) {
    if (dateKey >= v.start && dateKey <= v.end) return true;
  }
  return false;
}

export function setDateOverride(
  schedule: TeamSchedule,
  dateKey: string,
  override: DaySchedule | null
): TeamSchedule {
  const next: Record<string, DaySchedule> = { ...(schedule.date_overrides ?? {}) };
  if (override === null) {
    delete next[dateKey];
  } else {
    next[dateKey] = override;
  }
  return { ...schedule, date_overrides: next };
}

/** ВЫХОДНОЙ ЛИ ЭТА ДАТА — по ВСЕМУ графику: правка на дату, отпуск, недельный
 *  выходной. Тумблер «Выходной» в шторке метки читал только правку на дату:
 *  у воскресенья, выходного по неделе, он стоял выключенным, хотя сетка
 *  показывала «Вых» (повторный аудит 03.10). Графика нет — день рабочий. */
export function isDayOff(schedule: TeamSchedule | null | undefined, dateKey: string): boolean {
  if (!schedule) return false;
  const [y, m, d] = dateKey.split("-").map(Number);
  return !getDayScheduleForDate(schedule, new Date(y, m - 1, d)).is_working;
}

/** ВЫХОДНОЙ НА ДАТУ ВКЛ/ВЫКЛ — правкой на эту дату, недельный график цел.
 *
 *  Включить — день становится выходным (часы дня сохраняются в правке).
 *  Выключить — правка снимается, если без неё день рабочий; если же день
 *  выходной по неделе или в отпуске, правкой на дату он делается РАБОЧИМ по
 *  общим часам. Прежде снятие только удаляло правку — и воскресенье, выходное
 *  по неделе, из шторки сделать рабочим было нельзя (повторный аудит 03.10). */
export function setDayOff(schedule: TeamSchedule, dateKey: string, off: boolean): TeamSchedule {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Без правки день уже такой, как просят, — правка не нужна вовсе: день
  // возвращается под недельный график, а не застывает его копией.
  const without = setDateOverride(schedule, dateKey, null);
  if (getDayScheduleForDate(without, date).is_working === !off) return without;
  if (off) {
    const day = getDayScheduleForDate(schedule, date);
    return setDateOverride(schedule, dateKey, { ...day, is_working: false });
  }
  return setDateOverride(schedule, dateKey, {
    is_working: true,
    start: schedule.start,
    end: schedule.end,
    breaks: schedule.breaks ?? [],
  });
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
