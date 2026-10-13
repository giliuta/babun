import { changePct } from "./analytics-math";

// СПИСОК «К ПРОШЛОМУ ПЕРИОДУ». Цвет изменения — смысл, а не знак: рост
// расхода красный, падение — зелёное.

export interface DeltaColors {
  success: string;
  danger: string;
}

export interface Delta {
  text: string;
  color: string;
}

export function deltaOf(
  now: number,
  before: number,
  goodUp: boolean,
  colors: DeltaColors,
): Delta | null {
  const pct = changePct(now, before);
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  return {
    text: `${up ? "↑" : "↓"} ${Math.abs(pct)}%`,
    color: up === goodUp ? colors.success : colors.danger,
  };
}

export interface CompareRow {
  key: string;
  name: string;
  now: string;
  before: string;
  color: string;
  delta: Delta | null;
  share: number;
}

export function compareRow(
  key: string,
  name: string,
  now: number,
  before: number,
  fmt: (v: number) => string,
  color: string,
  colors: DeltaColors,
  goodUp = true,
): CompareRow {
  return {
    key,
    name,
    now: fmt(now),
    before: fmt(before),
    color,
    delta: deltaOf(now, before, goodUp, colors),
    share: Math.max(now, before) > 0 ? Math.max(0, now) / Math.max(now, before) : 0,
  };
}

export interface MonthTrendRow {
  key: string;
  profit: number;
  delta: Delta | null;
}

/** Месяцы новые сверху; изменение — к предыдущему месяцу таблицы. */
export function monthTrend(
  rows: readonly { key: string; profit: number }[],
  colors: DeltaColors,
): MonthTrendRow[] {
  return rows
    .map((m, i) => ({
      key: m.key,
      profit: m.profit,
      delta: i > 0 ? deltaOf(m.profit, rows[i - 1].profit, true, colors) : null,
    }))
    .reverse();
}
