// The app-wide period dialect (born in finances, reused by clients
// filters) — web parity with apps/web/src/lib/finance/period.ts (paired
// current/previous presets) plus the label helpers the LOCKED v5 header
// needs (name + dates split). All ranges are inclusive YYYY-MM-DD.

export type PeriodKind =
  | "today"
  | "yesterday"
  | "week"
  | "lastweek"
  | "month"
  | "lastmonth"
  | "year"
  | "lastyear"
  | "custom";

export interface Period {
  preset: PeriodKind;
  from: string;
  to: string;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "Текущая неделя",
  lastweek: "Прошлая неделя",
  month: "Текущий месяц",
  lastmonth: "Прошлый месяц",
  year: "Текущий год",
  lastyear: "Прошлый год",
  custom: "Свой период",
};

/** Paired current/previous presets for the preset-list popup blocks
 *  (web PERIOD_BLOCKS). */
export const PERIOD_BLOCKS: [PeriodKind, PeriodKind][] = [
  ["today", "yesterday"],
  ["week", "lastweek"],
  ["month", "lastmonth"],
  ["year", "lastyear"],
];

export function presetRange(
  preset: PeriodKind,
  base = new Date(),
): { from: string; to: string } {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: ymd(d), to: ymd(d) };
    }
    case "week": {
      // Monday-based ISO week, same as the calendar grid.
      const dow = (today.getDay() + 6) % 7;
      const monday = addDays(today, -dow);
      return { from: ymd(monday), to: ymd(addDays(monday, 6)) };
    }
    case "lastweek": {
      const dow = (today.getDay() + 6) % 7;
      const monday = addDays(today, -dow - 7);
      return { from: ymd(monday), to: ymd(addDays(monday, 6)) };
    }
    case "month":
      return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case "lastmonth":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "year":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(new Date(y, 11, 31)) };
    case "lastyear":
      return {
        from: ymd(new Date(y - 1, 0, 1)),
        to: ymd(new Date(y - 1, 11, 31)),
      };
    case "custom":
      // No custom range supplied — fall back to today (web parity).
      return { from: ymd(today), to: ymd(today) };
  }
}

export function makePeriod(preset: PeriodKind, base?: Date): Period {
  return { preset, ...presetRange(preset, base) };
}

export function defaultPeriod(base?: Date): Period {
  return makePeriod("month", base);
}

/** Semantic name for the header's LEFT tap target («Текущий месяц»). */
export function periodTitle(p: Period): string {
  return PERIOD_LABELS[p.preset];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function dmyShort(s: string): string {
  const d = parseYmd(s);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(
    d.getFullYear(),
  ).slice(2)}`;
}

/** Exact dates for the header's RIGHT tap target («01.06.26 – 30.06.26»). */
export function periodDates(p: Period): string {
  return p.from === p.to
    ? dmyShort(p.from)
    : `${dmyShort(p.from)} – ${dmyShort(p.to)}`;
}

const RU_MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

/** Friendly short range hint for a preset row («1–30 июн», year → «2026»).
 *  Mirrors the web PeriodPicker's presetHint. */
export function presetHint(kind: PeriodKind, base?: Date): string {
  const r = presetRange(kind, base);
  const a = parseYmd(r.from);
  if (kind === "year" || kind === "lastyear") return String(a.getFullYear());
  const b = parseYmd(r.to);
  if (r.from === r.to) return `${a.getDate()} ${RU_MONTHS_SHORT[a.getMonth()]}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear())
    return `${a.getDate()}–${b.getDate()} ${RU_MONTHS_SHORT[a.getMonth()]}`;
  return `${a.getDate()} ${RU_MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${
    RU_MONTHS_SHORT[b.getMonth()]
  }`;
}
