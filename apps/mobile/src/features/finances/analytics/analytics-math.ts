import type { Appointment } from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import {
  appointmentMaterialCost,
  appointmentMaterialCostLines,
  lineTotal,
} from "@babun/shared/local/finance/appointment-calc";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Service } from "@babun/shared/local/services";

// АНАЛИТИКА — ЧИСТЫЕ РАСЧЁТЫ (владелец 2026-09-24: «справа вверху аналитика,
// которая высчитывает по количеству предоставленных услуг, вся градация, по
// всем мастерам… продумай на максимум»).
//
// Два разных вопроса — два разных источника, и путать их нельзя:
//   • ДЕНЬГИ («Оплачено», «Расход», «Прибыль») — из журнала операций, тем же
//     правилом, что плитки «Финансов»: доход и возвраты со знаком, расход
//     операциями плюс материалы выполненных записей. Цифра сходится с
//     «Финансами» пальцем.
//   • РАБОТА («Работ на», услуги, записи, часы) — из выполненных записей:
//     что сделали, сколько штук, на какую сумму по прайсу записи.
// Выполненная запись — рабочая (не событие), не отменённая, и либо уже
// «выполнена», либо её день прошёл. Будущие записи — план, не сделанное.

export interface Scope {
  from: string;
  to: string;
  /** Сегодня в поясе компании — граница «уже сделано». */
  today: string;
  /** Команда среза; `null` — вся компания. */
  teamId: string | null;
  /** «ЧЧ:ММ» сейчас в поясе компании. Сегодняшняя запись считается сделанной,
   *  когда её время кончилось; не передали — только отмеченные выполненными. */
  nowHm?: string;
  /** Команда каждого счёта: строка журнала без команды считается под
   *  командой своего счёта — тем же правилом, что «Финансы» (`team-scope.ts`). */
  accountTeam?: ReadonlyMap<string, string | null>;
}

const cents = (v: number) => Math.round(v * 100);
const euros = (c: number) => c / 100;

// СЕГОДНЯШНЯЯ ЗАПИСЬ — СДЕЛАНА, КОГДА ЕЁ ВРЕМЯ ПРОШЛО (аудит 2026-09-24).
// Раньше хватало `date <= today`: запись на 18:00 ложилась в «Записи»,
// «Время» и «Средний чек» с утра, и цифры росли весь день сами, раньше работы.
export function isPerformed(a: Appointment, today: string, nowHm?: string): boolean {
  if (a.kind && a.kind !== "work") return false;
  if (a.status === "cancelled") return false;
  if (a.status === "completed" || a.status === "in_progress") return true;
  if (a.date < today) return true;
  return a.date === today && !!nowHm && !!a.time_end && a.time_end <= nowHm;
}

function inScope(a: Pick<Appointment, "date" | "team_id">, s: Scope): boolean {
  if (a.date < s.from || a.date > s.to) return false;
  return s.teamId === null || a.team_id === s.teamId;
}

export function performedRecords(
  appointments: readonly Appointment[],
  s: Scope,
): Appointment[] {
  return appointments.filter((a) => inScope(a, s) && isPerformed(a, s.today, s.nowHm));
}

/** Минуты записи из «HH:MM – HH:MM»; кривое время или ночь через полночь —
 *  ноль, а не отрицательные часы. */
export function recordMinutes(a: Pick<Appointment, "time_start" | "time_end">): number {
  const m = (t: string) => {
    const [h, mm] = (t ?? "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(mm) ? h * 60 + mm : NaN;
  };
  const d = m(a.time_end) - m(a.time_start);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export interface ServiceRow {
  id: string;
  name: string;
  /** Штук: сумма количеств по всем записям («×3 A/C Чистка» — три штуки). */
  quantity: number;
  /** В скольких записях встречалась. */
  records: number;
  amount: number;
}

/**
 * «ГРАДАЦИЯ ПО УСЛУГАМ»: что сделали, сколько штук и на какую сумму. Сумма —
 * строки записи (`lineTotal`: цена × шт − скидка строки), имя — со снимка
 * записи, а если его нет — из справочника: удалённая услуга остаётся в
 * истории под своим именем. Крупные сверху.
 */
export function serviceBreakdown(
  records: readonly Appointment[],
  catalog: ReadonlyMap<string, string>,
): ServiceRow[] {
  const by = new Map<string, { name: string; qty: number; recs: Set<string>; c: number }>();
  for (const a of records) {
    for (const line of a.services ?? []) {
      const id = line.serviceId;
      const name = line.serviceName?.trim() || catalog.get(id) || "Услуга удалена";
      const row = by.get(id) ?? { name, qty: 0, recs: new Set<string>(), c: 0 };
      row.qty += line.quantity ?? 1;
      row.recs.add(a.id);
      row.c += cents(lineTotal(line));
      by.set(id, row);
    }
  }
  return [...by.entries()]
    .map(([id, r]) => ({
      id,
      name: r.name,
      quantity: r.qty,
      records: r.recs.size,
      amount: euros(r.c),
    }))
    .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);
}

export interface MoneyTotals {
  income: number;
  expense: number;
  profit: number;
}

/** Деньги среза — правилом плиток «Финансов». */
export function moneyTotals(
  transactions: readonly FinanceTransaction[],
  appointments: readonly Appointment[],
  services: readonly Service[],
  s: Scope,
): MoneyTotals {
  let inc = 0;
  let exp = 0;
  for (const tx of ledgerInScope(transactions, s)) {
    if (tx.type === "income" || tx.type === "refund") inc += cents(signedAmount(tx));
    else if (tx.type === "expense") exp += cents(tx.amount);
  }
  exp += cents(materialTotals(appointments, services, s).amount);
  return { income: euros(inc), expense: euros(exp), profit: euros(inc - exp) };
}

export interface WorkTotals {
  records: number;
  /** Сумма работ по записям («работ на»). */
  worked: number;
  /** Сколько по этим записям пришло денег (включая предоплату). */
  paid: number;
  /** Средний чек — работ на одну запись. */
  averageCheck: number;
  minutes: number;
  /** Работ на час; `null` — часов нет. */
  perHour: number | null;
}

export function workTotals(records: readonly Appointment[]): WorkTotals {
  let worked = 0;
  let paid = 0;
  let minutes = 0;
  for (const a of records) {
    worked += cents(
      (a.services ?? []).length > 0
        ? (a.services ?? []).reduce((s, l) => s + lineTotal(l), 0)
        : a.total_amount ?? 0,
    );
    paid += cents(getPaidAmount(a));
    minutes += recordMinutes(a);
  }
  const n = records.length;
  return {
    records: n,
    worked: euros(worked),
    paid: euros(paid),
    averageCheck: n > 0 ? Math.round(worked / n) / 100 : 0,
    minutes,
    perHour: minutes > 0 ? Math.round((worked / (minutes / 60))) / 100 : null,
  };
}

export interface MonthRow extends MoneyTotals {
  /** YYYY-MM */
  key: string;
  from: string;
  to: string;
  worked: number;
  records: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Месяцы года с января по текущий (у прошлого года — все двенадцать). */
export function yearMonths(
  year: number,
  today: string,
): { key: string; from: string; to: string }[] {
  const [ty, tm] = today.split("-").map(Number);
  const last = year < ty ? 12 : year === ty ? tm : 0;
  const out = [];
  for (let m = 1; m <= last; m += 1) {
    const end = new Date(year, m, 0).getDate();
    out.push({
      key: `${year}-${pad(m)}`,
      from: `${year}-${pad(m)}-01`,
      to: `${year}-${pad(m)}-${pad(end)}`,
    });
  }
  return out;
}

export function monthTable(
  years: { from: number; to: number } | number,
  transactions: readonly FinanceTransaction[],
  appointments: readonly Appointment[],
  services: readonly Service[],
  base: Pick<Scope, "today" | "teamId" | "accountTeam" | "nowHm">,
): { rows: MonthRow[]; total: MonthRow } {
  // ПЕРИОД ЧЕРЕЗ НОВЫЙ ГОД — ВСЕ ЕГО ГОДЫ (аудит 2026-09-24): таблица
  // строилась по году начала, и у «20.12–10.01» январь выпадал из «Итого».
  const span = typeof years === "number" ? { from: years, to: years } : years;
  const months: { key: string; from: string; to: string }[] = [];
  for (let y = span.from; y <= span.to; y += 1) months.push(...yearMonths(y, base.today));
  const rows = months.map((m) => {
    const s = { ...base, from: m.from, to: m.to };
    const money = moneyTotals(transactions, appointments, services, s);
    const work = workTotals(performedRecords(appointments, s));
    return { ...m, ...money, worked: work.worked, records: work.records };
  });
  const sum = (k: "income" | "expense" | "profit" | "worked" | "records") =>
    k === "records"
      ? rows.reduce((s, r) => s + r.records, 0)
      : euros(rows.reduce((s, r) => s + cents(r[k]), 0));
  const total: MonthRow = {
    key: span.from === span.to ? `${span.from}` : `${span.from}–${span.to}`,
    from: `${span.from}-01-01`,
    to: `${span.to}-12-31`,
    income: sum("income"),
    expense: sum("expense"),
    profit: sum("profit"),
    worked: sum("worked"),
    records: sum("records"),
  };
  return { rows, total };
}

export interface TeamRow extends WorkTotals {
  id: string;
  name: string;
}

/** Разрез по командам — «по всем мастерам». Команды без работ за период не
 *  печатаются; записи без команды — отдельной строкой, если они есть. */
export function teamBreakdown(
  records: readonly Appointment[],
  teams: readonly { id: string; name: string }[],
): TeamRow[] {
  const by = new Map<string, Appointment[]>();
  for (const a of records) {
    const k = a.team_id ?? "__none__";
    const list = by.get(k);
    if (list) list.push(a);
    else by.set(k, [a]);
  }
  return [...by.entries()]
    .map(([id, list]) => ({
      id,
      name:
        id === "__none__"
          ? "Без команды"
          : (teams.find((t) => t.id === id)?.name ?? "Команда удалена"),
      ...workTotals(list),
    }))
    .sort((a, b) => b.worked - a.worked);
}

/** «181 ч» / «2 ч 30 мин» — время работы записей. */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** Материалы выполненных записей среза — строка «Материалы» в расходе. */
export function materialTotals(
  appointments: readonly Appointment[],
  services: readonly Service[],
  s: Scope,
): { amount: number; count: number } {
  let c = 0;
  let count = 0;
  for (const a of appointments) {
    if (a.status !== "completed" && a.status !== "in_progress") continue;
    if (!inScope(a, s)) continue;
    const cost = cents(appointmentMaterialCost(a, services as Service[]));
    if (cost <= 0) continue;
    c += cost;
    count += 1;
  }
  return { amount: euros(c), count };
}

/** Строки журнала среза: период и команда (строка без команды — под
 *  командой своего счёта). */
export function ledgerInScope(
  transactions: readonly FinanceTransaction[],
  s: Pick<Scope, "from" | "to" | "teamId" | "accountTeam">,
): FinanceTransaction[] {
  return transactions.filter((tx) => {
    if (tx.occurred_on < s.from || tx.occurred_on > s.to) return false;
    if (s.teamId === null) return true;
    const team =
      tx.team_id ?? (tx.account_id ? (s.accountTeam?.get(tx.account_id) ?? null) : null);
    return team === s.teamId;
  });
}

export interface ClientRow {
  id: string;
  records: number;
  worked: number;
}

/** Клиенты среза: сколько записей и на сколько работ. Крупные сверху. */
export function clientBreakdown(records: readonly Appointment[]): ClientRow[] {
  const by = new Map<string, Appointment[]>();
  for (const a of records) {
    if (!a.client_id) continue;
    const list = by.get(a.client_id);
    if (list) list.push(a);
    else by.set(a.client_id, [a]);
  }
  return [...by.entries()]
    .map(([id, list]) => {
      const w = workTotals(list);
      return { id, records: w.records, worked: w.worked };
    })
    .sort((a, b) => b.worked - a.worked || b.records - a.records);
}

export interface AccountRow {
  id: string;
  name: string;
  color: string | null;
  amount: number;
  count: number;
}

/** «ПО СЧЕТАМ» — наличные против карты: сколько пришло (или ушло) через
 *  каждый счёт. Доход — со знаком (возврат уменьшает счёт, как на плитке),
 *  расход — суммой. Счёт, которого нет в справочнике, — «Счёт закрыт». */
export function accountBreakdown(
  transactions: readonly FinanceTransaction[],
  kind: "income" | "expense",
  accounts: readonly { id: string; name: string; color?: string | null }[],
): AccountRow[] {
  const by = new Map<string, { c: number; n: number }>();
  for (const tx of transactions) {
    const fits =
      kind === "income"
        ? tx.type === "income" || tx.type === "refund"
        : tx.type === "expense";
    if (!fits) continue;
    const key = tx.account_id ?? "__none__";
    const row = by.get(key) ?? { c: 0, n: 0 };
    row.c += cents(kind === "income" ? signedAmount(tx) : tx.amount);
    row.n += 1;
    by.set(key, row);
  }
  return [...by.entries()]
    .map(([id, r]) => {
      const account = accounts.find((a) => a.id === id);
      return {
        id,
        name: account?.name ?? (id === "__none__" ? "Без счёта" : "Счёт закрыт"),
        color: account?.color ?? null,
        amount: euros(r.c),
        count: r.n,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface WeekdayRow {
  /** 0 — понедельник … 6 — воскресенье. */
  day: number;
  records: number;
  minutes: number;
}

/** ЗАГРУЖЕННОСТЬ ПО ДНЯМ НЕДЕЛИ — когда забито, когда пусто. Все семь дней,
 *  в том числе пустые: пустой вторник — тоже ответ. */
export function weekdayLoad(records: readonly Appointment[]): WeekdayRow[] {
  const rows: WeekdayRow[] = Array.from({ length: 7 }, (_, day) => ({
    day,
    records: 0,
    minutes: 0,
  }));
  for (const a of records) {
    const [y, m, d] = a.date.split("-").map(Number);
    if (!y || !m || !d) continue;
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const row = rows[(js + 6) % 7];
    row.records += 1;
    row.minutes += recordMinutes(a);
  }
  return rows;
}

/** Отменённые рабочие записи среза — «сколько выездов слито». */
export function cancelledCount(
  appointments: readonly Appointment[],
  s: Scope,
): number {
  return appointments.filter(
    (a) => (!a.kind || a.kind === "work") && a.status === "cancelled" && inScope(a, s),
  ).length;
}

// ─── Сравнение с прошлым периодом ─────────────────────────────────────

const ymdOf = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOf = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
};
const addDaysYmd = (ymd: string, n: number) => {
  const d = dateOf(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdOf(d);
};
const daysBetween = (from: string, to: string) =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * ПРОШЛЫЙ ПЕРИОД ДЛЯ СРАВНЕНИЯ — ЧЕСТНЫЙ (владелец 2026-09-24: «сравнивание
 * между месяцами — это очень хорошо»).
 *
 * Период, выровненный по календарю (месяц, квартал, год), сравнивается с
 * прошлым таким же — но ТЕМИ ЖЕ ДНЯМИ, если текущий ещё идёт: 1–24 сентября
 * против 1–24 августа, а не против всего августа. Иначе в середине месяца
 * любая цифра выглядела бы падением. Прочие периоды — отрезок той же длины
 * вплотную перед текущим.
 */
export function previousPeriod(
  from: string,
  to: string,
  today: string,
): { from: string; to: string; partial: boolean } {
  const effectiveTo = to > today && from <= today ? today : to;
  const partial = effectiveTo !== to;
  const elapsed = daysBetween(from, effectiveTo);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const monthsSpan = (ty - fy) * 12 + (tm - fm) + 1;
  const calendarAligned =
    fd === 1 && td === lastDayOfMonth(ty, tm) && [1, 3, 12].includes(monthsSpan);
  if (calendarAligned) {
    const start = new Date(Date.UTC(fy, fm - 1 - monthsSpan, 1));
    const prevFrom = ymdOf(start);
    const prevEnd = ymdOf(new Date(Date.UTC(fy, fm - 1, 0)));
    // Законченный период — весь прошлый целиком (в високосный год в нём на
    // день больше); идущий — столько же дней с начала.
    if (!partial) return { from: prevFrom, to: prevEnd, partial };
    const prevTo = addDaysYmd(prevFrom, elapsed);
    return { from: prevFrom, to: prevTo < prevEnd ? prevTo : prevEnd, partial };
  }
  const length = elapsed + 1;
  return { from: addDaysYmd(from, -length), to: addDaysYmd(from, -1), partial };
}

/** Изменение в процентах; прошлое ноль — сравнивать не с чем (`null`). */
export function changePct(current: number, previous: number): number | null {
  if (Math.round(previous * 100) === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

// ─── Прибыль по услугам ───────────────────────────────────────────────

export interface ServiceProfitRow extends ServiceRow {
  materials: number;
  profit: number;
}

/** ПРИБЫЛЬ ПО УСЛУГАМ — работы по услуге минус её материалы (тот же расчёт
 *  расхода по количеству, что у плитки «Расход»). Крупные по прибыли сверху. */
export function serviceProfit(
  rows: readonly ServiceRow[],
  records: readonly Appointment[],
  costServices: readonly Service[],
): ServiceProfitRow[] {
  const materials = new Map<string, number>();
  for (const a of records) {
    for (const line of appointmentMaterialCostLines(a, costServices as Service[])) {
      materials.set(line.serviceId, (materials.get(line.serviceId) ?? 0) + cents(line.totalCost));
    }
  }
  return rows
    .map((r) => {
      const m = materials.get(r.id) ?? 0;
      return { ...r, materials: euros(m), profit: euros(cents(r.amount) - m) };
    })
    .sort((a, b) => b.profit - a.profit);
}
