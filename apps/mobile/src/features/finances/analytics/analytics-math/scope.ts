// The slice (period + team), what counts as performed, and the ledger rows
// that fall into a slice.

import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

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

export const cents = (v: number) => Math.round(v * 100);
export const euros = (c: number) => c / 100;

// СЕГОДНЯШНЯЯ ЗАПИСЬ — СДЕЛАНА, КОГДА ЕЁ ВРЕМЯ ПРОШЛО.
// Одного `date <= today` мало: запись на 18:00 ложилась бы в «Записи»,
// «Время» и «Средний чек» с утра, и цифры росли бы весь день сами, раньше работы.
export function isPerformed(a: Appointment, today: string, nowHm?: string): boolean {
  if (a.kind && a.kind !== "work") return false;
  if (a.status === "cancelled") return false;
  if (a.status === "completed" || a.status === "in_progress") return true;
  if (a.date < today) return true;
  return a.date === today && !!nowHm && !!a.time_end && a.time_end <= nowHm;
}

export function inScope(a: Pick<Appointment, "date" | "team_id">, s: Scope): boolean {
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

/** Отменённые рабочие записи среза — «сколько выездов слито». */
export function cancelledCount(
  appointments: readonly Appointment[],
  s: Scope,
): number {
  return appointments.filter(
    (a) => (!a.kind || a.kind === "work") && a.status === "cancelled" && inScope(a, s),
  ).length;
}

// ─── Прогноз ──────────────────────────────────────────────────────────

/** ЗАПИСИ ВПЕРЕДИ — рабочие, не отменённые, ещё не сделанные записи среза:
 *  на сколько работ осталось до конца периода. Та же граница «сделано», что
 *  у плиток (`isPerformed`), поэтому одна запись не бывает и сделанной, и
 *  впереди. */
export function upcomingRecords(
  appointments: readonly Appointment[],
  s: Scope,
): Appointment[] {
  return appointments.filter(
    (a) =>
      (!a.kind || a.kind === "work") &&
      a.status !== "cancelled" &&
      inScope(a, s) &&
      !isPerformed(a, s.today, s.nowHm),
  );
}
