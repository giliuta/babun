import type { Appointment } from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import {
  appointmentMaterialCost,
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
  /** Команда каждого счёта: строка журнала без команды считается под
   *  командой своего счёта — тем же правилом, что «Финансы» (`team-scope.ts`). */
  accountTeam?: ReadonlyMap<string, string | null>;
}

const cents = (v: number) => Math.round(v * 100);
const euros = (c: number) => c / 100;

export function isPerformed(a: Appointment, today: string): boolean {
  if (a.kind && a.kind !== "work") return false;
  if (a.status === "cancelled") return false;
  return a.status === "completed" || a.date <= today;
}

function inScope(a: Pick<Appointment, "date" | "team_id">, s: Scope): boolean {
  if (a.date < s.from || a.date > s.to) return false;
  return s.teamId === null || a.team_id === s.teamId;
}

export function performedRecords(
  appointments: readonly Appointment[],
  s: Scope,
): Appointment[] {
  return appointments.filter((a) => inScope(a, s) && isPerformed(a, s.today));
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
  year: number,
  transactions: readonly FinanceTransaction[],
  appointments: readonly Appointment[],
  services: readonly Service[],
  base: Pick<Scope, "today" | "teamId" | "accountTeam">,
): { rows: MonthRow[]; total: MonthRow } {
  const rows = yearMonths(year, base.today).map((m) => {
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
    key: `${year}`,
    from: `${year}-01-01`,
    to: `${year}-12-31`,
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
    by.set(k, [...(by.get(k) ?? []), a]);
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
    by.set(a.client_id, [...(by.get(a.client_id) ?? []), a]);
  }
  return [...by.entries()]
    .map(([id, list]) => {
      const w = workTotals(list);
      return { id, records: w.records, worked: w.worked };
    })
    .sort((a, b) => b.worked - a.worked || b.records - a.records);
}
