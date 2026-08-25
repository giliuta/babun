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
