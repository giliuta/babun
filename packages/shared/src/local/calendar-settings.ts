// Calendar display settings. Persisted via the storage seam (WebKVStorage
// on web, MMKV on RN). Drives auto-scroll start position and grid range.

import { getStorage } from "../storage/provider";

export interface CalendarSettings {
  /** Visible-grid start hour. Determines what the user actually sees
   *  on the calendar — 0-23, default 9. Renamed conceptually in v438:
   *  treated as "visibleStartHour" but the field name stays for back-
   *  compat with any persisted localStorage entries. */
  startHour: number;
  /** Visible-grid end hour. 1-24 (24 = end of day), default 24. */
  endHour: number;
  /** Минуты границы «С», кратные `MINUTE_STEP`. Вместе с `startHour` дают то,
   *  что накрутили барабаны контрола времени. Барабан без этого поля был бы
   *  обманом: 08:30 сохранялось бы как 08:00. */
  startMinute?: number;
  /** Минуты границы «До». При `endHour === 24` всегда 0 — 1440-й минуты в
   *  сутках нет, и барабан минут на этом часе молчит. */
  endMinute?: number;
  gridStep: 15 | 30 | 60;    // minutes, default 30
  weekStart: "monday" | "sunday";
  timezone: string;           // default "Europe/Nicosia"
  // Sprint 033 Phase I35 — Bumpix-inspired calendar toggles.
  /** Minutes reserved after every appointment for travel / cleanup. The
   *  grid paints the gap as a band, and creating / rescheduling into it
   *  warns (never blocks — a dispatcher sometimes double-books on
   *  purpose, same rule as out-of-hours). 0 = off.
   *  Per-team override: `teams.buffer_minutes` (null = inherit this). */
  bufferMinutes?: number;
  /** Hide status=cancelled appointments from the calendar grid. */
  hideCancelled?: boolean;
  /** Полоса «Доход / Расход» под сеткой. Раньше она пряталась САМА, когда за
   *  видимую неделю не набиралось денег, — и выглядело это как пропавшая из
   *  продукта функция (владелец 2026-08-17). Теперь ответ даёт человек. */
  showDayFinance?: boolean;
  /** Allow an appointment to end past endHour (overflow). */
  allowOvertime?: boolean;
  // v438 — separate working hours from the visible range.
  /** Working-day start hour. The grid between work-start and work-end
   *  is highlighted (lighter background) so the user sees their work
   *  block at a glance. Falls back to startHour when undefined. */
  workStartHour?: number;
  /** Working-day end hour. Falls back to endHour when undefined. */
  workEndHour?: number;
  /** Hour the calendar auto-scrolls to on open. When undefined we
   *  use workStartHour, then startHour. */
  scrollOpenHour?: number;
  /** v492 — personal calendar labels. Subset of the global `cities`
   *  library that the user wants to surface on the personal calendar's
   *  per-day chip + label picker. Same shape as brigade `team.cities`,
   *  but scoped to the personal tab. Empty / undefined → no chip in
   *  the day header (existing v490 behaviour falls back to the full
   *  global pool, but with this list set the personal calendar is
   *  narrowed to user-curated items). */
  personalLabels?: string[];
  /** v492 — primary personal label. Equivalent to brigade
   *  `default_city`: when set, this label auto-paints on every day
   *  that has no per-date override. Empty / undefined → grey «+ метка»
   *  chip on every untagged day. */
  personalDefaultLabel?: string;
}

/**
 * Company-wide fields required to render and operate a work calendar.
 * Personal labels are deliberately absent: masters receive this projection
 * through a SECURITY DEFINER RPC instead of reading the raw settings row.
 */
export type OperationalCalendarSettings = Omit<
  CalendarSettings,
  "personalLabels" | "personalDefaultLabel"
>;

const STORAGE_KEY = "babun2:settings:calendar";
const OPERATIONAL_STORAGE_PREFIX = "babun2:settings:calendar:operational";

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  // СТАНДАРТ ПРОДУКТА (владелец 2026-08-17): «часы календаря — ноль-ноль до 24,
  // рабочие часы — с шести до 20:00; кто хочет поменять, тот заходит и меняет».
  //
  // Видимый отрезок — сутки целиком, чтобы поздний вызов можно было поставить,
  // не заходя сперва в настройки; сетка красит серым всё вне
  // workStartHour..workEndHour, поэтому «нерабочее» и так отличимо от смены.
  // Пара 0–24 больше НЕ кодовое «Автоматически» — этого режима в продукте нет
  // (см. features/calendar/window.ts).
  startHour: 0,
  endHour: 24,
  startMinute: 0,
  endMinute: 0,
  workStartHour: 6,
  workEndHour: 20,
  scrollOpenHour: 9,
  gridStep: 30,
  weekStart: "monday",
  timezone: "Europe/Nicosia",
  bufferMinutes: 0,
  hideCancelled: false,
  showDayFinance: true,
  allowOvertime: false,
};

// ЧАСОВЫЕ ПОЯСА. Было одиннадцать (владелец 2026-08-27: «добавь больше
// часовых поясов»). Список не машинный: полный набор IANA — это 400+ строк,
// среди которых человек ищет свой город дольше, чем печатает его руками.
// Здесь — Европа целиком плюс те города вне её, где сервисный бизнес уже
// встречается, по алфавиту зоны.
export const TIMEZONE_OPTIONS: string[] = [
  // Европа
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Belgrade",
  "Europe/Berlin",
  "Europe/Bratislava",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Chisinau",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Lisbon",
  "Europe/Ljubljana",
  "Europe/London",
  "Europe/Luxembourg",
  "Europe/Madrid",
  "Europe/Malta",
  "Europe/Minsk",
  "Europe/Moscow",
  "Europe/Nicosia",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Riga",
  "Europe/Rome",
  "Europe/Sarajevo",
  "Europe/Sofia",
  "Europe/Stockholm",
  "Europe/Tallinn",
  "Europe/Tirane",
  "Europe/Vienna",
  "Europe/Vilnius",
  "Europe/Warsaw",
  "Europe/Zagreb",
  "Europe/Zurich",
  // Ближний Восток и Кавказ
  "Asia/Baku",
  "Asia/Beirut",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Asia/Qatar",
  "Asia/Riyadh",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  // Центральная Азия
  "Asia/Almaty",
  "Asia/Tashkent",
  // Африка
  "Africa/Cairo",
  "Africa/Casablanca",
  // Америка
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Toronto",
];

export function loadCalendarSettings(): CalendarSettings {
  // Storage seam (STORY-035): WebKVStorage on web, MMKV on RN.
  const parsed = getStorage().get<Partial<CalendarSettings>>(STORAGE_KEY);
  if (!parsed) return DEFAULT_CALENDAR_SETTINGS;
  return sanitizeCalendarSettings({ ...DEFAULT_CALENDAR_SETTINGS, ...parsed });
}

// Repair settings loaded from older saves. v448 — flipped clamp
// direction: if a saved row has work/scroll-open OUTSIDE the visible
// range, EXPAND the visible range to include it. Previously work/
// scroll were silently snapped back into [startHour..endHour], which
// produced the "settings save+revert" surprise on the form.
function sanitizeCalendarSettings(s: CalendarSettings): CalendarSettings {
  const next = { ...s };

  // Hard bounds: visible range stays inside [0..24] and ≥ 1 h wide.
  next.startHour = Math.max(0, Math.min(23, next.startHour));
  next.endHour = Math.max(next.startHour + 1, Math.min(24, next.endHour));

  // Expand visible to fit work / scroll-open — they win.
  const ws = next.workStartHour ?? next.startHour;
  const we = next.workEndHour ?? next.endHour;
  const open = next.scrollOpenHour ?? ws;
  if (Number.isFinite(ws) && ws < next.startHour) next.startHour = Math.max(0, ws);
  if (Number.isFinite(we) && we > next.endHour) next.endHour = Math.min(24, we);
  if (Number.isFinite(open)) {
    if (open < next.startHour) next.startHour = Math.max(0, open);
    if (open > next.endHour) next.endHour = Math.min(24, open);
  }

  // Final clamp — work / scroll-open inside the (possibly expanded)
  // visible range, with a 1-hour minimum work band.
  next.workStartHour = Math.max(
    next.startHour,
    Math.min(ws, next.endHour - 1),
  );
  next.workEndHour = Math.min(
    next.endHour,
    Math.max(we, next.startHour + 1),
  );
  // endHour - 1, а не endHour: «Открывается на» — час, который встаёт СВЕРХУ
  // сетки при входе. На endHour сетка проскроллена в самый низ и показывает
  // пустой край. Раньше здесь стоял endHour, а форма предлагала максимум
  // endHour-1 — экран рисовал одно, база хранила другое.
  next.scrollOpenHour = Math.max(
    next.startHour,
    Math.min(open, next.endHour - 1),
  );

  return next;
}

export function saveCalendarSettings(settings: CalendarSettings): void {
  getStorage().set(STORAGE_KEY, settings);
}

/** Explicit allow-list so adding a private field to CalendarSettings later
 * cannot silently expose it through the master projection or its cache. */
export function toOperationalCalendarSettings(
  settings: CalendarSettings,
): OperationalCalendarSettings {
  return {
    startHour: settings.startHour,
    endHour: settings.endHour,
    gridStep: settings.gridStep,
    weekStart: settings.weekStart,
    timezone: settings.timezone,
    bufferMinutes: settings.bufferMinutes,
    hideCancelled: settings.hideCancelled,
    allowOvertime: settings.allowOvertime,
    workStartHour: settings.workStartHour,
    workEndHour: settings.workEndHour,
    scrollOpenHour: settings.scrollOpenHour,
  };
}

function operationalStorageKey(tenantId: string): string {
  return `${OPERATIONAL_STORAGE_PREFIX}:${tenantId}`;
}

/** Tenant-scoped cache for the non-private master projection. It must stay
 * separate from the owner cache, which may contain personal calendar labels. */
export function loadOperationalCalendarSettings(
  tenantId: string,
): OperationalCalendarSettings {
  const parsed = getStorage().get<Partial<OperationalCalendarSettings>>(
    operationalStorageKey(tenantId),
  );
  const settings = sanitizeCalendarSettings({
    ...DEFAULT_CALENDAR_SETTINGS,
    ...(parsed ?? {}),
  });
  return toOperationalCalendarSettings(settings);
}

export function saveOperationalCalendarSettings(
  tenantId: string,
  settings: OperationalCalendarSettings,
): void {
  const sanitized = sanitizeCalendarSettings({
    ...DEFAULT_CALENDAR_SETTINGS,
    ...settings,
  });
  getStorage().set(
    operationalStorageKey(tenantId),
    toOperationalCalendarSettings(sanitized),
  );
}
