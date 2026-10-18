// Local-calendar date math for the client roll-up.

/** Today as YYYY-MM-DD, in local time. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseKey(key: string): Date | null {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

export function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function birthdayInDays(birthday: string): number | null {
  if (!birthday) return null;
  const [, mm, dd] = birthday.split("-").map(Number);
  if (!mm || !dd) return null;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let target = new Date(today.getFullYear(), mm - 1, dd);
  if (target < t0) target = new Date(today.getFullYear() + 1, mm - 1, dd);
  return daysBetween(t0, target);
}

/** Медиана промежутков между визитами (дни). Меньше двух визитов — ритма
 *  ещё нет, возвращаем null: по одному приезду судить не о чем. */
export function medianGap(dates: readonly string[]): number | null {
  if (dates.length < 2) return null;
  const days = [...dates]
    .sort()
    .map((d) => parseKey(d))
    .filter((d): d is Date => d !== null);
  if (days.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i += 1) {
    const gap = daysBetween(days[i - 1], days[i]);
    // Два визита в один день — не промежуток, а один выезд из двух работ.
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1
    ? gaps[mid]
    : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}
