// Breakdowns of a slice: by team, client, account, weekday and service profit.

import type { Appointment } from "@babun/shared/local/appointments";
import { appointmentMaterialCostLines } from "@babun/shared/local/finance/appointment-calc";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Service } from "@babun/shared/local/services";
import { cents, euros, recordMinutes } from "./scope";
import { workTotals, type ServiceRow, type WorkTotals } from "./totals";

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
