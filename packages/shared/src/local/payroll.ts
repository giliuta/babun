// Payroll data layer.
//
// generateWeeklyPercent: % of brigade revenue for the week (lead 10%, helper 7%).
// generateMonthlyBase: flat €1000/mo per person.
// approve(): writes Expense records; markPaid(): stamps paidAt.

import { generateId } from "./masters";
import type {
  PayrollPeriod,
  PayrollLine,
  PayrollPeriodType,
} from "@babun/shared/db/types/finance";
import { loadBrigadeMembers } from "./brigades";
import { filterPayments, sumPaymentsCents } from "./payments";
import { createExpense } from "./expenses";

export type { PayrollPeriod, PayrollLine };

// ─── Storage ───────────────────────────────────────────────────────────

const PAYROLL_KEY = "babun2:finance:payroll_periods";

export function loadPayrollPeriods(): PayrollPeriod[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PAYROLL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePayrollPeriods(list: PayrollPeriod[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAYROLL_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function getPayrollPeriod(id: string): PayrollPeriod | undefined {
  return loadPayrollPeriods().find((p) => p.id === id);
}

function saveAndReturn(period: PayrollPeriod): PayrollPeriod {
  const list = loadPayrollPeriods();
  const idx = list.findIndex((p) => p.id === period.id);
  if (idx === -1) {
    list.push(period);
  } else {
    list[idx] = period;
  }
  savePayrollPeriods(list);
  return period;
}

// ─── Week range helper ─────────────────────────────────────────────────

export interface WeekRange {
  /** YYYY-MM-DD Monday */
  start: string;
  /** YYYY-MM-DD Sunday */
  end: string;
}

/** Return ISO week range (Mon–Sun) containing the given YYYY-MM-DD date. */
export function isoWeekRange(date: string): WeekRange {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toISOString().slice(0, 10),
    end: sun.toISOString().slice(0, 10),
  };
}

/** Return YYYY-MM-01 / YYYY-MM-last for a month string "YYYY-MM". */
export function monthRange(month: string): { start: string; end: string } {
  const [year, mo] = month.split("-").map(Number);
  const last = new Date(year, mo, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

// ─── Generators ────────────────────────────────────────────────────────

/**
 * Generate a weekly % payroll draft for a brigade.
 * Revenue = sum of FinancePayments in the week range.
 * Each active member gets: revenue × (percentRate / 100).
 */
export function generateWeeklyPercent(
  brigadeId: string,
  weekRange: WeekRange
): PayrollPeriod {
  const members = loadBrigadeMembers().filter(
    (m) =>
      m.brigadeId === brigadeId &&
      m.joinedAt <= weekRange.end &&
      (m.leftAt === null || m.leftAt >= weekRange.start)
  );

  const payments = filterPayments({
    brigadeId,
    dateFrom: weekRange.start,
    dateTo: weekRange.end,
  });
  const revenueEuroCents = sumPaymentsCents(payments);

  const periodId = generateId("pp");
  const lines: PayrollLine[] = members.map((m) => {
    const amountCents = Math.round((revenueEuroCents * m.percentRate) / 100);
    return {
      id: generateId("pl"),
      periodId,
      masterId: m.masterId,
      brigadeId,
      type: "weekly_percent" as PayrollPeriodType,
      amountCents,
      description: `${brigadeId} ${weekRange.start}–${weekRange.end} — ${m.percentRate}% of ${(revenueEuroCents / 100).toFixed(2)} EUR`,
    };
  });

  const period: PayrollPeriod = {
    id: periodId,
    brigadeId,
    periodStart: weekRange.start,
    periodEnd: weekRange.end,
    type: "weekly_percent",
    lines,
    totalCents: lines.reduce((acc, l) => acc + l.amountCents, 0),
    status: "draft",
    approvedAt: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
  };

  return saveAndReturn(period);
}

/**
 * Generate monthly base salary draft.
 * Each active member gets baseMonthlySalaryCents for the month.
 */
export function generateMonthlyBase(
  brigadeId: string,
  month: string
): PayrollPeriod {
  const range = monthRange(month);
  const members = loadBrigadeMembers().filter(
    (m) =>
      m.brigadeId === brigadeId &&
      m.joinedAt <= range.end &&
      (m.leftAt === null || m.leftAt >= range.start)
  );

  const periodId = generateId("pp");
  const lines: PayrollLine[] = members.map((m) => ({
    id: generateId("pl"),
    periodId,
    masterId: m.masterId,
    brigadeId,
    type: "monthly_base" as PayrollPeriodType,
    amountCents: m.baseMonthlySalaryCents,
    description: `${brigadeId} ${month} — base salary €${(m.baseMonthlySalaryCents / 100).toFixed(2)}`,
  }));

  const period: PayrollPeriod = {
    id: periodId,
    brigadeId,
    periodStart: range.start,
    periodEnd: range.end,
    type: "monthly_base",
    lines,
    totalCents: lines.reduce((acc, l) => acc + l.amountCents, 0),
    status: "draft",
    approvedAt: null,
    paidAt: null,
    createdAt: new Date().toISOString(),
  };

  return saveAndReturn(period);
}

// ─── Approve / pay ─────────────────────────────────────────────────────

/**
 * Approve a payroll period draft → status "approved".
 * Creates one Expense record per PayrollLine (scope=brigade, category=salary).
 */
export function approvePeriod(id: string): PayrollPeriod | null {
  const list = loadPayrollPeriods();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const period = list[idx];
  if (period.status !== "draft") return period;

  const now = new Date().toISOString();
  for (const line of period.lines) {
    createExpense({
      scope: "brigade",
      brigadeId: line.brigadeId,
      appointmentId: null,
      category: "salary",
      description: line.description,
      amountCents: line.amountCents,
      date: period.periodEnd,
    });
  }

  list[idx] = { ...period, status: "approved", approvedAt: now };
  savePayrollPeriods(list);
  return list[idx];
}

/** Mark a period as paid. */
export function markPaid(id: string): PayrollPeriod | null {
  const list = loadPayrollPeriods();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  if (list[idx].status === "draft") return null;
  list[idx] = { ...list[idx], status: "paid", paidAt: new Date().toISOString() };
  savePayrollPeriods(list);
  return list[idx];
}

// ─── Queries ───────────────────────────────────────────────────────────

export function listPeriodsForBrigade(brigadeId: string): PayrollPeriod[] {
  return loadPayrollPeriods().filter((p) => p.brigadeId === brigadeId);
}
