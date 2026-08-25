// v329 — Client roll-up statistics for the /clients list.
//
// Each ClientCard needs to show: last visit / next appointment, total
// spent, debt, days since the record was created, and days until the
// next birthday.  Computing these per-render for 900+ clients × 5000+
// appointments is too slow, so we build a single Map<clientId, ...>
// once per appointments change and the page reads from it in O(1).
//
// Pure functions only — no React.  The hook (useStatsMap) lives in
// the page itself wrapped in useMemo.
//
// Design notes:
//   * Some seed/legacy appointments have client_id = null but the
//     contact's name baked into `comment` or service description.  We
//     fall back by matching `full_name` so historical AirFix data
//     doesn't show as zero-visit ghosts.
//   * Birthday is normalized to "MM-DD" — year is irrelevant for the
//     "ДР на неделе" calculation.
//   * Date math uses local time (Cyprus calendar), not UTC, so a
//     visit at 18:00 Limassol counts as today even if UTC has rolled
//     over.

import type { Appointment } from "../appointments";
import { getPaidAmount, getDebtAmount } from "../appointments";
import type { Client } from "../clients";

export interface ClientStats {
  /** Number of completed visits. */
  visits: number;
  /** Lifetime money paid by the client. */
  totalSpent: number;
  /** YYYY-MM-DD of the most recent completed visit, or "" if none. */
  lastVisitDate: string;
  /** Number of days since lastVisitDate, or null if never visited. */
  lastVisitDays: number | null;
  /** Next future appointment, scheduled OR in_progress. */
  nextApt: { date: string; time: string } | null;
  /** Days until nextApt (0 = today, 1 = tomorrow), or null. */
  nextAptDays: number | null;
  /** ЛИЧНЫЙ РИТМ КЛИЕНТА — медиана промежутков между его завершёнными
   *  визитами, в днях. null, когда визитов меньше двух: ритма ещё нет.
   *
   *  Нужен вместо общего порога «давно не был». Один порог на всех врёт в
   *  обе стороны: клининг ездит раз в неделю, кондиционеры — раз в полгода,
   *  и 60 дней для первого катастрофа, а для второго норма. Медиана, а не
   *  среднее: один сезонный пропуск не должен сдвигать норму. */
  medianGapDays: number | null;
  /** Сколько объектов клиента ПРОСРОЧЕНО по своему интервалу обслуживания
   *  (`Location.serviceEveryMonths`). 0 — обслуживать нечего или ещё рано.
   *
   *  Регулярное обслуживание — основная выручка сервиса, и до сих пор оно
   *  было видно только внутри карточки: чтобы понять, кого пора звать,
   *  приходилось открывать все карточки руками. */
  serviceDue: number;
  /** ПРОШЕДШИЕ НЕЗАКРЫТЫЕ ВИЗИТЫ: запись стоит «запланирована», а дата уже
   *  прошла. Работу почти наверняка сделали, но её никто не закрыл — значит
   *  визит не считается визитом, деньги не попали ни в долг, ни в выручку,
   *  а клиент выглядит тем, кто «так и не приехал».
   *
   *  Календарь это состояние знает и красит янтарём; список клиентов до
   *  сих пор не знал (аудит 2026-08-07). */
  unclosedVisits: number;
  /** Неполученные деньги: завершённые визиты с недоплатой ПЛЮС прошедшие
   *  записи, по которым команда не отчиталась, — для владельца это одно и
   *  то же «нам не заплатили». */
  debt: number;
  /** Expected revenue — Σ total_amount of FUTURE scheduled/in-progress
   *  appointments (today or later). Powers the card's grey «ожидаемая
   *  прибыль» figure. 0 when the client has no upcoming bookings. */
  expectedRevenue: number;
  /** team_id of the client's most-recent COMPLETED visit that carried one
   *  — drives the «команда» segment on the list card. null if the client
   *  has no completed visits with a team (future-only bookings don't count). */
  lastTeamId: string | null;
  /** Days since the client record was created. */
  ageDays: number;
  /** Days until the next birthday (0–365), or null when no birthday. */
  birthdayInDays: number | null;
}

const EMPTY_STATS: ClientStats = {
  visits: 0,
  totalSpent: 0,
  lastVisitDate: "",
  lastVisitDays: null,
  nextApt: null,
  nextAptDays: null,
  medianGapDays: null,
  serviceDue: 0,
  unclosedVisits: 0,
  debt: 0,
  expectedRevenue: 0,
  lastTeamId: null,
  ageDays: 0,
  birthdayInDays: null,
};

// ─── Date helpers ─────────────────────────────────────────────────

/** Today as YYYY-MM-DD, in local time. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): Date | null {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// ─── Public — single client ────────────────────────────────────────

/** Loose name normalisation for the seed-data fallback. */
function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Does the client name appear as a WHOLE word/phrase inside the (already
 *  normalised) comment? Plain `.includes()` over-matches short names
 *  («Ан» ловит «диван», «Иван» ловит «Иванов») — require the match to be
 *  bounded by non-letters (or string edges). Both args must be normName'd.
 *  Keeps the intended «comment contains the name + extra text» case. */
export function nameInComment(commentNorm: string, cnameNorm: string): boolean {
  if (!cnameNorm) return false;
  let from = 0;
  for (;;) {
    const i = commentNorm.indexOf(cnameNorm, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : commentNorm[i - 1];
    const after = commentNorm[i + cnameNorm.length] ?? "";
    // Пустой край строки — тоже граница; \p{L} ловит и кириллицу.
    if (!/\p{L}/u.test(before) && !/\p{L}/u.test(after)) return true;
    from = i + 1;
  }
}

export function buildStats(
  // `locations` нужен для срока обслуживания объектов; поле необязательное,
  // чтобы старые вызовы с урезанным клиентом продолжали работать.
  client: Pick<Client, "id" | "full_name" | "created_at" | "birthday"> &
    Partial<Pick<Client, "locations">>,
  apts: Appointment[],
): ClientStats {
  if (apts.length === 0) {
    return computeNonAptFields(client, { ...EMPTY_STATS });
  }
  const cid = client.id;
  const cname = normName(client.full_name);
  let visits = 0;
  let totalSpent = 0;
  let debt = 0;
  let lastVisitDate = "";
  let nextApt: { date: string; time: string } | null = null;
  let expectedRevenue = 0;
  let lastTeamId: string | null = null;
  let lastTeamKey = "";
  /** Даты завершённых визитов — из них считается личный ритм. */
  const visitDates: string[] = [];
  /** Последний завершённый визит НА КАЖДЫЙ объект — для срока обслуживания. */
  const lastByLocation = new Map<string, string>();
  let unclosedVisits = 0;
  const today = todayKey();

  for (const a of apts) {
    // Match by id; fall back to comment-name match for seed records
    // that pre-date client_id linkage.
    const matchById = a.client_id === cid;
    const matchByName =
      a.client_id == null && nameInComment(normName(a.comment), cname);
    if (!matchById && !matchByName) continue;

    // ДОЛГ ВОЗНИКАЕТ И БЕЗ ОТМЕТКИ БРИГАДЫ. Владелец 2026-08-09: «прошло
    // время записи — оно автоматически перебрасывается в долг, всё равно
    // надо принимать решение по клиенту». Прошедшая неотменённая работа,
    // по которой бригадир не отчитался, — это те же неполученные деньги,
    // что и закрытый визит без оплаты. Отдельной корзины «не закрыто» в
    // деньгах нет: она делила одно и то же надвое.
    //
    // ВИЗИТОМ такая запись не считается — визитов у клиента ровно столько,
    // сколько подтверждённых работ; на них живут ритм, «Пропали» и доход.
    if (a.status !== "completed" && a.status !== "cancelled" && a.date < today) {
      debt += getDebtAmount(a);
    }

    if (a.status === "completed") {
      visits += 1;
      totalSpent += getPaidAmount(a);
      debt += getDebtAmount(a);
      if (a.date) visitDates.push(a.date);
      if (a.date > lastVisitDate) lastVisitDate = a.date;
      // «команда» = team of the most-recent COMPLETED visit that had one.
      // Composite date+time key (mirrors nextApt) so same-day visits
      // resolve to the latest deterministically, not by array order.
      if (a.team_id) {
        const k = a.date + a.time_start;
        if (k >= lastTeamKey) {
          lastTeamKey = k;
          lastTeamId = a.team_id;
        }
      }
    }

    // ПОСЛЕДНИЙ ВЫЕЗД НА ОБЪЕКТ — для срока обслуживания. Считаем ЛЮБУЮ
    // неотменённую запись с прошедшей датой, а не только `completed`:
    // незакрытая вчерашняя работа — это тоже «мы там были», и карточка
    // объекта (service-plan.ts) считает ровно так же. Пока условия
    // расходились, список говорил «пора обслужить», а карточка молчала.
    if (
      a.status !== "cancelled" &&
      a.date &&
      a.date <= today &&
      a.location_id
    ) {
      const prev = lastByLocation.get(a.location_id);
      if (!prev || a.date > prev) lastByLocation.set(a.location_id, a.date);
    }

    // Future or in-progress visits → candidate for "next".
    const upcoming =
      a.status === "scheduled" || a.status === "in_progress";
    // Прошедшая и незакрытая — не «следующая» и не визит. Считаем отдельно:
    // это работа, повисшая без денег.
    if (upcoming && a.date && a.date < today) unclosedVisits += 1;
    if (upcoming && a.date >= today) {
      expectedRevenue += a.total_amount ?? 0;
      const cur = nextApt;
      const candKey = a.date + a.time_start;
      const curKey = cur ? cur.date + cur.time : "";
      if (!cur || candKey < curKey) {
        nextApt = { date: a.date, time: a.time_start };
      }
    }
  }

  // Дни считаются между КАЛЕНДАРНЫМИ днями (полночь↔полночь), а не от
  // «сейчас»: иначе визит вчера утром к вечеру округлялся до «2 дня
  // назад», и «Давно не были» давал разный список утром и вечером.
  const todayD = parseKey(todayKey())!;
  const lastVisitDays = lastVisitDate
    ? daysBetween(parseKey(lastVisitDate)!, todayD)
    : null;
  const nextAptDays = nextApt
    ? daysBetween(todayD, parseKey(nextApt.date)!)
    : null;
  const medianGapDays = medianGap(visitDates);
  const serviceDue = countServiceDue(client, lastByLocation, todayKey());

  return computeNonAptFields(client, {
    visits,
    totalSpent: Math.round(totalSpent),
    debt: Math.round(debt),
    expectedRevenue: Math.round(expectedRevenue),
    lastTeamId,
    lastVisitDate,
    lastVisitDays,
    nextApt,
    nextAptDays,
    medianGapDays,
    serviceDue,
    unclosedVisits,
    ageDays: 0,
    birthdayInDays: null,
  });
}

function computeNonAptFields(
  client: Pick<Client, "created_at" | "birthday">,
  base: ClientStats,
): ClientStats {
  const created = isoToDate(client.created_at);
  const ageDays =
    created
      ? Math.max(
          0,
          daysBetween(
            new Date(
              created.getFullYear(),
              created.getMonth(),
              created.getDate(),
            ),
            new Date(
              new Date().getFullYear(),
              new Date().getMonth(),
              new Date().getDate(),
            ),
          ),
        )
      : 0;
  return {
    ...base,
    ageDays,
    birthdayInDays: birthdayInDays(client.birthday),
  };
}

function birthdayInDays(birthday: string): number | null {
  if (!birthday) return null;
  const [, mm, dd] = birthday.split("-").map(Number);
  if (!mm || !dd) return null;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let target = new Date(today.getFullYear(), mm - 1, dd);
  if (target < t0) target = new Date(today.getFullYear() + 1, mm - 1, dd);
  return daysBetween(t0, target);
}

// ─── Public — full map (the fast path the page uses) ───────────────

/**
 * Walks `apts` once, bucketing by `client_id` and (for seed) by name.
 * Then iterates clients to compose the final stats.  Total work is
 * O(N + M) for N clients and M appointments.  Memoise in the page
 * with `useMemo`.
 */
export function buildStatsMap(
  clients: Client[],
  apts: Appointment[],
): Map<string, ClientStats> {
  // First pass: index appointments.
  const byId = new Map<string, Appointment[]>();
  const orphanByName = new Map<string, Appointment[]>();
  for (const a of apts) {
    if (a.client_id) {
      const arr = byId.get(a.client_id);
      if (arr) arr.push(a);
      else byId.set(a.client_id, [a]);
    } else {
      const key = normName(a.comment);
      if (key) {
        const arr = orphanByName.get(key);
        if (arr) arr.push(a);
        else orphanByName.set(key, [a]);
      }
    }
  }

  // Second pass: compose per client.
  const out = new Map<string, ClientStats>();
  for (const c of clients) {
    const own = byId.get(c.id) ?? [];
    let combined: Appointment[];
    if (orphanByName.size > 0) {
      const cname = normName(c.full_name);
      const orphans: Appointment[] = [];
      // Bounded-name scan — only for orphans, in practice <50 of them.
      for (const [name, arr] of orphanByName) {
        if (nameInComment(name, cname)) orphans.push(...arr);
      }
      combined = orphans.length === 0 ? own : own.concat(orphans);
    } else {
      combined = own;
    }
    out.set(c.id, buildStats(c, combined));
  }
  return out;
}

/** Fast helper for page-level segment counts. */
/** «Пропал»: был у нас, давно не приезжал И НЕ ЗАПИСАН ВПЕРЁД.
 *
 *  Проверка `nextApt` добавлена 2026-08-07: без неё в список на обзвон
 *  попадал клиент, который был 90 дней назад и приезжает завтра —
 *  диспетчер звонил зря и переставал верить фильтру.
 *
 *  Порог сравнивается через `>=`: ряд называется «60+ дней», а строгое
 *  `>` означало 61 — подпись обязана описывать РОВНО предикат. */
/** Прибавить месяцы к YYYY-MM-DD, не перескакивая через конец месяца
 *  (31 января + 1 месяц = 28/29 февраля, а не 3 марта). */
function addMonthsKey(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const target = m - 1 + months;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(Math.min(d, lastDay))}`;
}

/** Сколько объектов клиента просрочено по своему интервалу. Отсчёт — от
 *  ПОСЛЕДНЕГО визита на этот объект: даты «когда обслужили» никто не
 *  заполняет руками, значит её невозможно забыть проставить. */
function countServiceDue(
  client: Partial<Pick<Client, "locations">>,
  lastByLocation: Map<string, string>,
  today: string,
): number {
  let due = 0;
  for (const loc of client.locations ?? []) {
    const months = loc.serviceEveryMonths ?? 0;
    if (!months) continue;
    const last = lastByLocation.get(loc.id);
    // Ни одного визита — обслуживать ещё нечего, отсчёт начнётся с первого.
    if (!last) continue;
    if (addMonthsKey(last, months) <= today) due += 1;
  }
  return due;
}

/** Медиана промежутков между визитами (дни). Меньше двух визитов — ритма
 *  ещё нет, возвращаем null: по одному приезду судить не о чем. */
function medianGap(dates: readonly string[]): number | null {
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

export function isLongSilence(s: ClientStats, days = 60): boolean {
  return (
    s.visits > 0 &&
    s.nextApt === null &&
    (s.lastVisitDays ?? 0) >= days
  );
}
export function isLoyalClient(s: ClientStats, minVisits = 5): boolean {
  return s.visits >= minVisits;
}
