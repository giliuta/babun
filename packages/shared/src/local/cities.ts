// Cities reference book. Persisted in localStorage.
// Used in client forms, appointment forms, and reports.

export interface City {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  /** Sprint 033: per-city accent colour. Used for the calendar column
   *  tint + day-header chip on /dashboard. Custom tags like «Германия»
   *  or «День ног» all pick one colour here and show up in calendar.
   *  Optional for backward compat — missing colour falls back to the
   *  legacy CITIES palette in lib/day-cities.ts or neutral grey. */
  color?: string;
}

/** Colour palette for city / tag pickers. Sprint 033 Phase I20 —
 *  aliased to the unified PRESET_COLORS so brigade / city /
 *  service-group / service all share one palette (13 colours,
 *  iOS system hues). */
import { PRESET_COLORS } from "@babun/shared/common/utils/colors";
export const CITY_COLOR_PRESETS = PRESET_COLORS;

const STORAGE_KEY = "babun2:settings:cities";

// STORY-078 leak fix — Cyprus cities were leaking into every fresh
// tenant regardless of country. Default is now empty; owner adds
// cities in Settings → Cities. Old constant kept exposed for the
// vertical-driven onboarding seed (future story).
export const SEED_CITIES: City[] = [];

export const CYPRUS_CITIES_PRESET: City[] = [
  { id: "city-limassol",  name: "Лимассол",  country: "Cyprus", isActive: true, color: "#FF9500" },
  { id: "city-paphos",    name: "Пафос",     country: "Cyprus", isActive: true, color: "#32ADE6" },
  { id: "city-larnaca",   name: "Ларнака",   country: "Cyprus", isActive: true, color: "#34C759" },
  { id: "city-nicosia",   name: "Никосия",   country: "Cyprus", isActive: true, color: "#AF52DE" },
  { id: "city-ayia-napa", name: "Айя-Напа",  country: "Cyprus", isActive: true, color: "#FFCC00" },
];

export function loadCities(): City[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCities(cities: City[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cities));
  } catch {
    // ignore quota errors
  }
}

export function generateCityId(): string {
  return `city-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getActiveCities(cities: City[]): City[] {
  return cities.filter((c) => c.isActive);
}
