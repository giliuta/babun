import type { Service } from "@/features/services/queries";

// Pure helpers of the booking form.

/** «HH:MM» → minutes from midnight; «24:00» is the end of the day. Anything
 *  else (garbage, 24:30, minutes over 59) → null. */
export const absoluteMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    hours < 0 ||
    hours > 24 ||
    minutes < 0 ||
    minutes > 59 ||
    (hours === 24 && minutes !== 0)
  ) {
    return null;
  }
  return hours * 60 + minutes;
};

/** First value of a route param (expo-router may hand an array). */
export const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

/** СЛОТ = БУФЕРЫ + РАБОТА. Буферы берутся МАКСИМАЛЬНЫЕ по выбранным услугам,
 *  а не суммируются: дорога до адреса одна, и две работы в одном визите не
 *  удваивают её. Без этого календарь показывал свободное время, которого нет,
 *  — бригада в нём едет. */
export function serviceBuffersMinutes(
  ids: readonly string[],
  catalog: Map<string, Service>,
): number {
  const before = Math.max(
    0,
    ...ids.map((id) => catalog.get(id)?.buffer_before_min ?? 0),
    0,
  );
  const after = Math.max(
    0,
    ...ids.map((id) => catalog.get(id)?.buffer_after_min ?? 0),
    0,
  );
  return before + after;
}
