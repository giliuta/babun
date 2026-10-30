import { formatYMD } from "@/features/appointments/helpers";

// Device-local calendar helpers for the calendar screen. Not the shared
// `date-utils` ones: its `addDays` keeps the time of day, these snap to local
// midnight first.

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
// "HH:MM" → fractional hours, null on garbage (web dashboard/page.tsx
// parseHour, :570-575). The team-hub TimeField can persist free text, so
// every read here falls back to the global setting instead of breaking
// the grid.
export function parseHourHM(s: string | null | undefined): number | null {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  const val = h + m / 60;
  return val >= 0 && val <= 24 ? val : null;
}

/** Anchor of the repeat-expansion window: the 1st of the month in month
 *  view, otherwise the start of a fixed 28-day bucket, so swipes inside a
 *  bucket keep the same anchor. */
export function repeatExpandAnchor(day: Date, monthWindow: boolean): string {
  if (monthWindow) return formatYMD(new Date(day.getFullYear(), day.getMonth(), 1));
  const epochDays = Math.floor(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000,
  );
  const bucketStart = epochDays - (((epochDays % 28) + 28) % 28);
  const d = new Date(bucketStart * 86_400_000);
  return formatYMD(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Expansion window around an anchor: neighbouring months plus week tails in
 *  month view, otherwise −35…+90 days. */
export function repeatExpandWindow(
  anchorYmd: string,
  monthWindow: boolean,
): { fromKey: string; toKey: string } {
  const [ay, am, ad] = anchorYmd.split("-").map(Number);
  const anchor = new Date(ay, am - 1, ad);
  const fromKey = formatYMD(
    monthWindow
      ? addDays(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1), -7)
      : addDays(anchor, -35),
  );
  const toKey = formatYMD(
    monthWindow
      ? addDays(new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0), 7)
      : addDays(anchor, 90),
  );
  return { fromKey, toKey };
}
