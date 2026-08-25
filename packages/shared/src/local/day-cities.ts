// Per-team per-date city overrides. When a brigade is working in a
// non-default city on a given day, the dispatcher assigns it via the
// calendar day header. Keys are "<teamId>:<YYYY-MM-DD>".
//
// Здесь только форма и правила чтения: писать/читать день ходит через
// db/repositories/day-cities.ts.

export type DayCityMap = Record<string, string>;

/** Сентинел «метка явно снята» в day_cities (web v693): день с ним НЕ
 *  падает обратно на default_city команды — пустая строка удалила бы
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

export function dayCityKey(teamId: string, dateKey: string): string {
  return `${teamId}:${dateKey}`;
}

/** Насыщенный цвет + два фона столбца на одну метку.
 *  @deprecated Живой палитры больше нет — тип держит только справочный
 *  CYPRUS_CITY_PRESETS ниже. */
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

/** STORY-079 leak fix — эта палитра БЫЛА зашита как дефолт и доставалась
 *  каждому новому тенанту независимо от страны. Сейчас она ничего не
 *  красит и оставлена справочным слепком под vertical-driven onboarding
 *  seed (решение отложено). Читателей нет — снести можно только вместе
 *  с этим решением.
 *  @deprecated */
export const CYPRUS_CITY_PRESETS: Record<string, CityConfig> = {
  "Пафос":    { name: "Пафос",    code: "ПФ", c1: "#38BDF8", color: "#0284C7", bg: "#F0F9FF", bgToday: "#E0F2FE" },
  "Лимассол": { name: "Лимассол", code: "ЛМ", c1: "#FB923C", color: "#EA580C", bg: "#FFF7ED", bgToday: "#FFEDD5" },
  "Ларнака":  { name: "Ларнака",  code: "ЛК", c1: "#34D399", color: "#059669", bg: "#ECFDF5", bgToday: "#D1FAE5" },
  "Никосия":  { name: "Никосия",  code: "НК", c1: "#C084FC", color: "#7C3AED", bg: "#FAF5FF", bgToday: "#EDE9FE" },
};
