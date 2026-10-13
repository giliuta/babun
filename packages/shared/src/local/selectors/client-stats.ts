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

import { EMPTY_STATS, type ClientStats } from "./client-stats/types";
import {
  birthdayInDays,
  daysBetween,
  isoToDate,
  medianGap,
  parseKey,
  todayKey,
} from "./client-stats/dates";

export type { ClientStats } from "./client-stats/types";

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

/** ВИЗИТ — подтверждённая работа, запись со статусом «выполнено». Одно
 *  правило на всё, что говорит «был»: число визитов и «был 30 мая» в сводке,
 *  «был 12 авг» у объекта (`object-last-visit.ts`). Прошедшая незакрытая
 *  запись визитом не считается — она уходит в долг, а не в историю приездов. */
export function isVisit(a: Pick<Appointment, "status">): boolean {
  return a.status === "completed";
}

/** НЕПОЛУЧЕННЫЕ ДЕНЬГИ ОДНОЙ ЗАПИСИ — ровно то, из чего складывается долг
 *  клиента. Вынесено из `buildStats`, чтобы фильтр «Неоплаченные» в истории
 *  визитов отбирал записи ТЕМ ЖЕ правилом, которым сводка печатает «Долг»:
 *  своё правило на экране истории разошлось бы с суммой, по которой тапнули.
 *
 *  Выполненная — недоплата; отменённая — ничего; прошедшая, по которой
 *  бригада не отчиталась, — тоже долг (владелец 2026-08-09, см. ниже);
 *  будущая — ещё не долг. `today` — локальный YYYY-MM-DD. */
export function appointmentDebt(
  a: Appointment,
  today: string,
): number {
  if (a.status === "cancelled") return 0;
  if (isVisit(a)) return getDebtAmount(a);
  return a.date < today ? getDebtAmount(a) : 0;
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
  let unclosedVisits = 0;
  let lastUnclosedDate = "";
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
    debt += appointmentDebt(a, today);

    if (isVisit(a)) {
      visits += 1;
      totalSpent += getPaidAmount(a);
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

    // Future or in-progress visits → candidate for "next".
    const upcoming =
      a.status === "scheduled" || a.status === "in_progress";
    // Прошедшая и незакрытая — не «следующая» и не визит. Считаем отдельно:
    // это работа, повисшая без денег.
    if (upcoming && a.date && a.date < today) {
      unclosedVisits += 1;
      if (a.date > lastUnclosedDate) lastUnclosedDate = a.date;
    }
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
    unclosedVisits,
    lastUnclosedDate,
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
