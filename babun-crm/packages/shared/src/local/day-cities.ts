// Per-team per-date city overrides. When a brigade is working in a
// non-default city on a given day, the dispatcher assigns it via the
// calendar day header. Keys are "<teamId>:<YYYY-MM-DD>".

const STORAGE_KEY = "babun-day-cities";

export type DayCityMap = Record<string, string>;

/** Сентинел «метка явно снята» в day_cities (web v693): день с ним НЕ
 *  падает обратно на default_city бригады — пустая строка удалила бы
 *  override, и дефолт перекрасил бы день на следующем рендере. */
export const CITY_CLEARED = "__NONE__";

/** ЯВНАЯ метка дня для команды+даты: null, если метки нет или она снята
 *  сентинелом. Без фолбэка на default_city команды — это правило
 *  автоприсвоения метки клиенту (решение владельца 2026-07-22);
 *  календарный рендер со своим фолбэком живёт в labelFor. */
export function resolveDayLabel(
  map: DayCityMap,
  teamId: string | null,
  dateKey: string,
): string | null {
  if (!teamId) return null;
  const raw = (map[dayCityKey(teamId, dateKey)] ?? "").trim();
  return raw === "" || raw === CITY_CLEARED ? null : raw;
}

export function loadDayCities(): DayCityMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DayCityMap;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveDayCities(map: DayCityMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function dayCityKey(teamId: string, dateKey: string): string {
  return `${teamId}:${dateKey}`;
}

// Returns the assigned city for this team+date, or an empty string if
// none. Callers should fall back to the team's default_city when empty.
export function getDayCity(
  map: DayCityMap,
  teamId: string | null,
  dateKey: string
): string {
  if (!teamId) return "";
  return map[dayCityKey(teamId, dateKey)] ?? "";
}

export function setDayCity(
  map: DayCityMap,
  teamId: string,
  dateKey: string,
  city: string
): DayCityMap {
  const key = dayCityKey(teamId, dateKey);
  const next = { ...map };
  if (city.trim() === "") {
    delete next[key];
  } else {
    next[key] = city.trim();
  }
  return next;
}

// ─── Typed city palette (single source of truth) ──────────────────────
// По спеке: для каждого города — насыщенный цвет + светлый фон столбца
// + чуть темнее фон сегодня. Используется на календаре и в city-picker.

export interface CityConfig {
  name: string;
  code: string; // двухбуквенный код для компакта
  /** Тёмный оттенок = конец градиента заголовка + цвет текста/событий. */
  color: string;
  /** Светлый оттенок = начало градиента заголовка (135°). */
  c1: string;
  /** Светлый фон столбца = конец fade-перехода под заголовком. */
  bg: string;
  /** Чуть темнее для сегодняшнего дня. */
  bgToday: string;
}

// STORY-079 leak fix — was hardcoded Cyprus 4-city palette which
// every fresh tenant inherited regardless of country. Empty by
// default; the CYPRUS_CITY_PRESETS export is kept so the future
// vertical-driven onboarding seed can pull from it explicitly.
//
// Calendar code that needs a CityConfig falls back to
// `cityConfigFromColor(name, color)` using the per-tenant city
// records loaded from `cities.ts` (Settings → Cities).
export const CITIES: Record<string, CityConfig> = {};

export const CITY_LIST: CityConfig[] = [];

export const CITY_PRESETS: string[] = [];

// Reference palette retained for vertical-driven seed (deferred).
export const CYPRUS_CITY_PRESETS: Record<string, CityConfig> = {
  "Пафос":    { name: "Пафос",    code: "ПФ", c1: "#38BDF8", color: "#0284C7", bg: "#F0F9FF", bgToday: "#E0F2FE" },
  "Лимассол": { name: "Лимассол", code: "ЛМ", c1: "#FB923C", color: "#EA580C", bg: "#FFF7ED", bgToday: "#FFEDD5" },
  "Ларнака":  { name: "Ларнака",  code: "ЛК", c1: "#34D399", color: "#059669", bg: "#ECFDF5", bgToday: "#D1FAE5" },
  "Никосия":  { name: "Никосия",  code: "НК", c1: "#C084FC", color: "#7C3AED", bg: "#FAF5FF", bgToday: "#EDE9FE" },
};

export function getCityConfig(city: string): CityConfig | null {
  return CITIES[city] ?? null;
}

export function getCityColor(city: string): string {
  return CITIES[city]?.color ?? "#6b7280";
}

export function getCityBg(city: string, today: boolean): string | null {
  const cfg = CITIES[city];
  if (!cfg) return null;
  return today ? cfg.bgToday : cfg.bg;
}

// Sprint 033 — custom tags (Германия, День ног, …) get a user-picked
// accent colour stored on settings.cities. Derive a CityConfig from
// that single colour + the city name so DayColumn renders consistently
// for legacy 4-city presets and new tags.

/** Derives c1 / bg / bgToday shades from a single accent colour so the
 *  calendar header gradient + column tint + today tint still look like
 *  a cohesive set. We use rgba so the shade works on any surface
 *  without needing a colour-mix polyfill. */
export function cityConfigFromColor(name: string, color: string): CityConfig {
  const code = name.trim().slice(0, 2).toUpperCase();
  const rgb = hexToRgb(color);
  const c1 = color; // gradient start = same hue (we'll let CSS blend it)
  const bg = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)` : "#F2F2F7";
  const bgToday = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)` : "#E5E5EA";
  return { name, code, color, c1, bg, bgToday };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let h = match[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
