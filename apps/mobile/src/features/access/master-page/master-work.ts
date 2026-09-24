// «РАБОТА» СОТРУДНИКА — СВОДКА МЕСЯЦА (STORY-087). Лист без React: счёт
// проверяется тестом.
//
// Записи принадлежат КАЛЕНДАРЮ (`team_id`), у работ `master_id` пуст — работа
// сотрудника считается по его календарям. События (`kind: "event"`) — не
// работа: в счёт не идут.

export interface WorkLike {
  date: string;
  team_id: string | null;
  status?: string | null;
  kind?: string | null;
}

export interface MonthWork {
  /** Записей в этом месяце (без отменённых). */
  total: number;
  /** Из них выполнено. */
  done: number;
}

export function monthWorkOf(
  rows: readonly WorkLike[],
  teamIds: readonly string[],
  now: Date,
): MonthWork {
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const teams = new Set(teamIds);
  let total = 0;
  let done = 0;
  for (const row of rows) {
    if (row.kind === "event") continue;
    if (!row.team_id || !teams.has(row.team_id)) continue;
    if (!row.date.startsWith(ym)) continue;
    if (row.status === "cancelled") continue;
    total += 1;
    if (row.status === "completed") done += 1;
  }
  return { total, done };
}

const MONTHS_PREP = [
  "январе", "феврале", "марте", "апреле", "мае", "июне",
  "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
];

function recordsWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "записей";
  if (ones === 1) return "запись";
  if (ones >= 2 && ones <= 4) return "записи";
  return "записей";
}

/** «7 записей в сентябре · 5 выполнено»; пусто — «в сентябре нет». */
export function workLine(work: MonthWork, now: Date = new Date()): string {
  const month = MONTHS_PREP[now.getMonth()];
  if (work.total === 0) return `в ${month} нет`;
  const base = `${work.total} ${recordsWord(work.total)} в ${month}`;
  return work.done > 0 ? `${base} · ${work.done} выполнено` : base;
}

// ─── СТРАНИЦА «ЗАПИСИ» СОТРУДНИКА ────────────────────────────────────────
// Была двумя старыми портами с веба («Визиты» и «Статистика»), и оба искали
// записи по `master_id` — а у работ он пуст: страницы всегда были пустыми,
// хотя блок «Работа» считал «4 записи в сентябре». Теперь одна страница по
// календарям сотрудника: период, итоги периода, записи по дням.

export type WorkPeriod = "week" | "month" | "year";

export const WORK_PERIODS: readonly { value: WorkPeriod; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
];

const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Окно периода — `[from, to]` включительно, строками «ГГГГ-ММ-ДД». Неделя —
 *  с понедельника, месяц и год — календарные. */
export function workWindow(period: WorkPeriod, now: Date): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (period === "month") {
    return { from: ymdOf(new Date(y, m, 1)), to: ymdOf(new Date(y, m + 1, 0)) };
  }
  const monday = new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: ymdOf(monday), to: ymdOf(sunday) };
}

export interface WorkRow extends WorkLike {
  id: string;
  time_start: string;
  total_amount?: number | null;
  payment_status?: string | null;
}

export interface WorkSummary {
  total: number;
  done: number;
  cancelled: number;
  /** Выручка выполненных — как в KPI: полностью возвращённые не в счёт. */
  revenue: number;
}

export interface WorkDay<R> {
  date: string;
  rows: R[];
}

/** Итоги и записи периода по календарям сотрудника. События — не работа.
 *  Дни идут от ближних к будущему сначала, прошлое — от свежего к старому:
 *  «что впереди» важнее «что было». */
export function workOfPeriod<R extends WorkRow>(
  rows: readonly R[],
  teamIds: readonly string[],
  window: { from: string; to: string },
  today: string,
): { summary: WorkSummary; upcoming: WorkDay<R>[]; past: WorkDay<R>[] } {
  const teams = new Set(teamIds);
  const summary: WorkSummary = { total: 0, done: 0, cancelled: 0, revenue: 0 };
  const byDate = new Map<string, R[]>();
  for (const row of rows) {
    if (row.kind === "event") continue;
    if (!row.team_id || !teams.has(row.team_id)) continue;
    if (row.date < window.from || row.date > window.to) continue;
    if (row.status === "cancelled") {
      summary.cancelled += 1;
    } else {
      summary.total += 1;
      if (row.status === "completed") {
        summary.done += 1;
        if (row.payment_status !== "refunded") {
          summary.revenue += Math.max(0, row.total_amount ?? 0);
        }
      }
    }
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const days = [...byDate.entries()].map(([date, list]) => ({
    date,
    rows: list.sort((a, b) => a.time_start.localeCompare(b.time_start)),
  }));
  const upcoming = days.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = days.filter((d) => d.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return { summary, upcoming, past };
}
