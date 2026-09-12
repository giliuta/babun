export { TIMEZONE_OPTIONS } from "./timezones";
// Calendar display settings. Persisted via the storage seam (WebKVStorage
// on web, MMKV on RN).
//
// ЧЕТЫРЕ ПОЛЯ СНЕСЕНЫ 2026-09-10 ПО СЛОВУ ВЛАДЕЛЬЦА — все четыре не читал
// НИКТО, то есть обещали настройку, которой не было:
//   `gridStep`   — «сетка всегда 30 минут, не больше и не меньше»;
//   `weekStart`  — «всегда с понедельника по воскресенье»;
//   `allowOvertime` — «если человек хочет записать за пределами часов, он
//                   тапает, сверху появляется уведомление с кнопкой
//                   „Записать"» (это и есть живое поведение — `CalendarNotice`);
//   `scrollOpenHour` — календарь открывается на часе НАЧАЛА ГРАФИКА КОМАНДЫ
//                   («график с 18:00 — открывается в 18:00»); это уже делает
//                   `deriveScrollHour`, беря рабочую полосу дня.
// Колонки в базе (`grid_step`, `week_start`, `allow_overtime`,
// `scroll_open_hour`) остались: они `not null default`, и запись без них
// проходит. Сносить их — отдельная миграция и отдельное решение.

import { getStorage } from "../storage/provider";

/** Ситуации, которыми красится запись, когда своего цвета у неё нет. Список
 *  ЕДИНСТВЕННЫЙ: подписи к этим же идентификаторам живут в приложении
 *  (`features/appointments/record-color.ts`) и берут ids отсюда — двух списков
 *  одного и того же не бывает. */
export const RECORD_COLOR_SITUATIONS = [
  "noClient",
  "noObject",
  "noServices",
] as const;

export type RecordColorSituation = (typeof RECORD_COLOR_SITUATIONS)[number];

/** Чем красить запись, у которой нет своего цвета. */
export type RecordColorRule = "team" | "label" | "service";

export const RECORD_COLOR_RULES: readonly RecordColorRule[] = [
  "team",
  "label",
  "service",
];

/** Цвет на ситуацию. `null` у ситуации — «эта ситуация не красит»; отсутствие
 *  всей палитры — «владелец не трогал, действуют заводские цвета». */
export type RecordColorPalette = Partial<
  Record<RecordColorSituation, string | null>
>;

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
  /** Зона IANA. ВСЕГДА валидная строка — никаких null и sentinel-ов: её
   *  читают три десятка мест и сразу отдают в `Intl`, который на null падает. */
  timezone: string;
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
  // v438 — separate working hours from the visible range.
  /** Working-day start hour. The grid between work-start and work-end
   *  is highlighted (lighter background) so the user sees their work
   *  block at a glance. Falls back to startHour when undefined. */
  workStartHour?: number;
  /** Working-day end hour. Falls back to endHour when undefined. */
  workEndHour?: number;
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
  /** Настройки цвета записи. ЖИЛИ НА ТЕЛЕФОНЕ и переехали сюда 2026-09-12:
   *  правило, палитра ситуаций и запасной цвет лежали только в MMKV, и два
   *  устройства ОДНОГО владельца показывали разные цвета одних и тех же
   *  записей. Настройка компании не имеет права жить на устройстве.
   *  `undefined` значит «владелец не выбирал»: заводские значения знает
   *  экран, а не хранилище. */
  recordColorRule?: RecordColorRule;
  recordColorPalette?: RecordColorPalette;
  recordColorFallback?: string;
}

/**
 * Company-wide fields required to render and operate a work calendar.
 * Personal labels are deliberately absent: masters receive this projection
 * through a SECURITY DEFINER RPC instead of reading the raw settings row.
 */
export type OperationalCalendarSettings = Omit<
  CalendarSettings,
  // Контрактный тест мастерского среза ловит любую попытку протащить сюда
  // личное поле.
  | "personalLabels"
  | "personalDefaultLabel"
  // Цвета записи сюда НЕ входят, и это не забывчивость: их не отдаёт
  // `read_operational_calendar_settings_safe()` — единственный путь мастера к
  // настройкам. Пока функция их не знает, у мастера цвета заводские, и тип
  // обязан говорить это вслух, а не обещать поле, которого не будет.
  // Чинится вместе с переписыванием безопасных функций — очередь прав на
  // календарь (docs/PLAN-CALENDARS-2026-09-10.md).
  | "recordColorRule"
  | "recordColorPalette"
  | "recordColorFallback"
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
  // ЗОНА ТЕЛЕФОНА, А НЕ КИПР (2026-08-27). До этого здесь была прибита
  // Europe/Nicosia, а `Intl.DateTimeFormat().resolvedOptions().timeZone` не
  // вызывался в продукте НИ РАЗУ: мастер в Варшаве жил по кипрским суткам,
  // ни разу не открыв настройки, и «сегодня» в его кассе кончалось в 23:00.
  // Фолбэк остаётся Кипром — на случай, если Intl вернул пустое.
  timezone: deviceZone(),
  bufferMinutes: 0,
  hideCancelled: false,
  showDayFinance: true,
};

// ЧАСОВЫЕ ПОЯСА. Было одиннадцать (владелец 2026-08-27: «добавь больше
// часовых поясов»). Список не машинный: полный набор IANA — это 400+ строк,
// среди которых человек ищет свой город дольше, чем печатает его руками.
// Здесь — Европа целиком плюс те города вне её, где сервисный бизнес уже
// встречается, по алфавиту зоны.
/** Зона устройства. Дублируется здесь (а не импортируется из mobile), потому
 *  что дефолты живут в shared, а shared не вправе зависеть от приложения. */
function deviceZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && z.length > 2 ? z : "Europe/Nicosia";
  } catch {
    return "Europe/Nicosia";
  }
}


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
/** Шестизначный hex и ничего кроме. Цвет уезжает прямо в стили и в
 *  измеритель контраста: строка вроде «rgba(...)» или «blue» ломает и то, и
 *  другое молча — блок просто становится прозрачным. */
function hexOrNull(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : null;
}

/** Палитра ситуаций из чего угодно: чужие ключи выбрасываются, значения —
 *  либо честный hex, либо явный `null` («ситуация не красит»). Пустая палитра
 *  возвращается как `undefined` — «владелец не выбирал» и «владелец выбрал
 *  ничего» это разные вещи, и хранилище обязано их различать. */
function sanitizeRecordPalette(
  value: unknown,
): RecordColorPalette | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const out: RecordColorPalette = {};
  let touched = false;
  for (const id of RECORD_COLOR_SITUATIONS) {
    if (!(id in raw)) continue;
    out[id] = hexOrNull(raw[id]);
    touched = true;
  }
  return touched ? out : undefined;
}

/** ЕДИНСТВЕННЫЙ разбор цветов записи из чего угодно: им пользуются и разбор
 *  локального кэша, и маппер строки базы. Две проверки одного и того же
 *  разъезжаются в первый же месяц — этой уже случалось с полями часов. */
export function sanitizeRecordColorSettings(input: {
  rule?: unknown;
  palette?: unknown;
  fallback?: unknown;
}): Pick<
  CalendarSettings,
  "recordColorRule" | "recordColorPalette" | "recordColorFallback"
> {
  return {
    recordColorRule: RECORD_COLOR_RULES.includes(input.rule as RecordColorRule)
      ? (input.rule as RecordColorRule)
      : undefined,
    recordColorPalette: sanitizeRecordPalette(input.palette),
    recordColorFallback: hexOrNull(input.fallback) ?? undefined,
  };
}

function sanitizeCalendarSettings(s: CalendarSettings): CalendarSettings {
  const next = { ...s };

  Object.assign(
    next,
    sanitizeRecordColorSettings({
      rule: next.recordColorRule,
      palette: next.recordColorPalette,
      fallback: next.recordColorFallback,
    }),
  );

  // Hard bounds: visible range stays inside [0..24] and ≥ 1 h wide.
  next.startHour = Math.max(0, Math.min(23, next.startHour));
  next.endHour = Math.max(next.startHour + 1, Math.min(24, next.endHour));

  // Expand visible to fit work / scroll-open — they win.
  const ws = next.workStartHour ?? next.startHour;
  const we = next.workEndHour ?? next.endHour;
  if (Number.isFinite(ws) && ws < next.startHour) next.startHour = Math.max(0, ws);
  if (Number.isFinite(we) && we > next.endHour) next.endHour = Math.min(24, we);

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
    timezone: settings.timezone,
    bufferMinutes: settings.bufferMinutes,
    hideCancelled: settings.hideCancelled,
    workStartHour: settings.workStartHour,
    workEndHour: settings.workEndHour,
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
