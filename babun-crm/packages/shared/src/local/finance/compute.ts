// Single source of truth for income, expense and profit across the
// whole app. The tabs inside /dashboard/finances historically
// diverged because they read from different stores and formatted in
// different units. computeFinancials() fixes that by:
//
//   1. Accepting every money-bearing source at once (appointments,
//      standalone FinancePayments, standalone Expenses, day extras).
//   2. Converting everything into euros-integer before summation —
//      never mix cents and euros.
//   3. Returning a fully labelled line list so callers can display the
//      same breakdown on any screen.
//
// All input monetary values get normalised on entry:
//   - Appointment.payments[*].amount / apt.prepaid_amount → already euros
//   - Appointment.expenses[*].amount → already euros
//   - Service material unit cost × Appointment.services quantity → euros
//   - DayExtra.amount → already euros
//   - FinancePayment.amountCents → divided by 100
//   - Expense.amountCents → divided by 100
//
// The returned numbers are always euros (integer). formatEUR() can be
// called on them verbatim.

import { getPaidAmount, type Appointment } from "../appointments";
import type { Service } from "../services";
import { appointmentMaterialCostLines } from "./appointment-calc";
import type { Team } from "../masters";
import type { DayExtra } from "../day-extras";
import type {
  FinancePayment,
  Expense as StandaloneExpense,
} from "@babun/shared/db/types/finance";

export interface FinanceRange {
  /** YYYY-MM-DD inclusive. `null` means "all time". */
  from: string | null;
  /** YYYY-MM-DD inclusive. */
  to: string;
}

export type FinanceSource =
  | "apt-payment"
  | "apt-material"
  | "apt-expense"
  | "extra-income"
  | "extra-expense"
  | "standalone-payment"
  | "standalone-expense";

export interface FinanceLine {
  id: string;
  dateKey: string;
  description: string;
  /** Euros, integer. Always positive; `source` tells income vs expense. */
  amount: number;
  teamId: string | null;
  category?: string;
  source: FinanceSource;
  refId: string;
}

export interface ComputeFinancialsInput {
  appointments: Appointment[];
  services: Service[];
  teams: Team[];
  /**
   * Lookup for day-level extras. Signature matches the shape
   * `useDayExtras` already exposes on the dashboard layout.
   */
  dayExtrasOf: (teamId: string, dateKey: string) => DayExtra[];
  standalonePayments: FinancePayment[];
  standaloneExpenses: StandaloneExpense[];
  clientsById?: Map<string, { full_name: string }>;
  range: FinanceRange;
  /** Team id or "all". Defaults to "all". */
  teamFilter?: string;
}

export interface ComputeFinancialsResult {
  incomeLines: FinanceLine[];
  expenseLines: FinanceLine[];
  totalIncome: number;
  totalExpense: number;
  profit: number;
  /** Integer percent 0–100. Rounded. */
  margin: number;
  /** Cash tendered (for cashbox expected). Euros. */
  cash: number;
  /** Card tendered. Euros. */
  card: number;
  /** Bank transfer tendered. Euros. */
  transfer: number;
  /** Invoice / split / other or unknown payment methods. Euros. */
  otherPayment: number;
}

export function centsToEur(cents: number): number {
  return Math.round(cents / 100);
}

export function inFinanceRange(dateKey: string, r: FinanceRange): boolean {
  if (r.from === null) return dateKey <= r.to;
  return dateKey >= r.from && dateKey <= r.to;
}

export function datesInFinanceRange(r: FinanceRange): string[] {
  if (r.from === null) return [];
  const out: string[] = [];
  const [sy, sm, sd] = r.from.split("-").map(Number);
  const [ey, em, ed] = r.to.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const stop = new Date(ey, em - 1, ed);
  while (cur <= stop) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function describeAppointment(
  apt: Appointment,
  servicesById: Map<string, Service>,
  clientsById?: Map<string, { full_name: string }>
): string {
  const name =
    (apt.client_id && clientsById?.get(apt.client_id)?.full_name) ||
    apt.comment ||
    "Запись";
  const services = apt.service_ids
    .map((sid) => servicesById.get(sid)?.name)
    .filter(Boolean)
    .join(", ");
  return services ? `${services} — ${name}` : name;
}

export function computeFinancials(
  input: ComputeFinancialsInput
): ComputeFinancialsResult {
  const {
    appointments,
    services,
    teams,
    dayExtrasOf,
    standalonePayments,
    standaloneExpenses,
    clientsById,
    range,
    teamFilter = "all",
  } = input;

  const servicesById = new Map(services.map((s) => [s.id, s]));
  const teamMatches = (teamId: string | null): boolean =>
    teamFilter === "all" || teamId === teamFilter;

  const incomeLines: FinanceLine[] = [];
  const expenseLines: FinanceLine[] = [];
  let cash = 0;
  let card = 0;
  let transfer = 0;
  let otherPayment = 0;

  for (const apt of appointments) {
    if (apt.status !== "completed" && apt.status !== "in_progress") continue;
    if (!inFinanceRange(apt.date, range)) continue;
    if (!teamMatches(apt.team_id)) continue;

    const paid = getPaidAmount(apt);
    if (paid > 0) {
      incomeLines.push({
        id: `apt-${apt.id}`,
        dateKey: apt.date,
        description: describeAppointment(apt, servicesById, clientsById),
        amount: paid,
        teamId: apt.team_id,
        source: "apt-payment",
        refId: apt.id,
      });
    }

    // Receipt rows remain attached after a full refund as audit history.
    // They are no longer current tender and therefore must not survive in
    // the cash/card breakdown after getPaidAmount() has already netted the
    // appointment's revenue to zero.
    if (apt.payment_status !== "refunded") {
      for (const p of apt.payments ?? []) {
        if (p.amount <= 0) continue;
        if (p.method === "cash") cash += p.amount;
        else if (p.method === "card") card += p.amount;
        else if (p.method === "transfer") transfer += p.amount;
        else otherPayment += p.amount;
      }
      if ((apt.prepaid_amount ?? 0) > 0) {
        // `payment_method` is persisted together with a booking prepayment.
        // Never invent cash for legacy rows: that inflates the physical
        // cashbox. Missing/transfer/other methods belong to the non-cash
        // bucket until the operator supplies an explicit tender.
        if (apt.payment_method === "cash") cash += apt.prepaid_amount;
        else if (apt.payment_method === "card") card += apt.prepaid_amount;
        else if (apt.payment_method === "transfer") {
          transfer += apt.prepaid_amount;
        }
        else otherPayment += apt.prepaid_amount;
      }
    }

    for (const material of appointmentMaterialCostLines(apt, services)) {
      expenseLines.push({
        id: `mat-${apt.id}-${material.serviceId}`,
        dateKey: apt.date,
        description: `Материалы: ${material.serviceName}`,
        amount: material.totalCost,
        teamId: apt.team_id,
        category: "Материалы",
        source: "apt-material",
        refId: apt.id,
      });
    }

    for (const ex of apt.expenses ?? []) {
      if (ex.amount > 0) {
        expenseLines.push({
          id: `aptex-${apt.id}-${ex.id}`,
          dateKey: apt.date,
          description: ex.name || "Расход",
          amount: ex.amount,
          teamId: apt.team_id,
          category: "Прочее",
          source: "apt-expense",
          refId: apt.id,
        });
      }
    }
  }

  const dates = datesInFinanceRange(range);
  const relevantTeams =
    teamFilter === "all" ? teams : teams.filter((t) => t.id === teamFilter);
  for (const team of relevantTeams) {
    for (const dk of dates) {
      for (const ex of dayExtrasOf(team.id, dk)) {
        const base = {
          id: `ex-${team.id}-${dk}-${ex.id}`,
          dateKey: dk,
          description: ex.name || (ex.kind === "income" ? "Доход" : "Расход"),
          amount: ex.amount,
          teamId: team.id,
          refId: ex.id,
        };
        if (ex.kind === "income") {
          incomeLines.push({ ...base, source: "extra-income" });
        } else {
          expenseLines.push({
            ...base,
            category: "Прочее",
            source: "extra-expense",
          });
        }
      }
    }
  }

  for (const p of standalonePayments) {
    const dateKey = p.paidAt.slice(0, 10);
    if (!inFinanceRange(dateKey, range)) continue;
    if (!teamMatches(p.brigadeId)) continue;
    const eur = centsToEur(p.amountCents);
    if (eur <= 0) continue;
    incomeLines.push({
      id: `sp-${p.id}`,
      dateKey,
      description: p.note || "Платёж",
      amount: eur,
      teamId: p.brigadeId,
      source: "standalone-payment",
      refId: p.id,
    });
    if (p.method === "cash") cash += eur;
    else if (p.method === "card") card += eur;
    else if (p.method === "transfer") transfer += eur;
    else otherPayment += eur;
  }

  for (const e of standaloneExpenses) {
    if (!inFinanceRange(e.date, range)) continue;
    if (e.scope === "brigade" && !teamMatches(e.brigadeId)) continue;
    if (e.scope === "appointment") {
      // Appointment-scope expenses are already counted via apt.expenses.
      continue;
    }
    const eur = centsToEur(e.amountCents);
    if (eur <= 0) continue;
    expenseLines.push({
      id: `se-${e.id}`,
      dateKey: e.date,
      description: e.description || "Расход",
      amount: eur,
      teamId: e.brigadeId,
      category: e.category,
      source: "standalone-expense",
      refId: e.id,
    });
  }

  const totalIncome = incomeLines.reduce((s, l) => s + l.amount, 0);
  const totalExpense = expenseLines.reduce((s, l) => s + l.amount, 0);
  const profit = totalIncome - totalExpense;
  const margin =
    totalIncome > 0 ? Math.round((profit / totalIncome) * 100) : 0;

  return {
    incomeLines,
    expenseLines,
    totalIncome,
    totalExpense,
    profit,
    margin,
    cash,
    card,
    transfer,
    otherPayment,
  };
}
