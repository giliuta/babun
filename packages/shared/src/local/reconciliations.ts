// Daily reconciliation data layer.
//
// End-of-day cash-box check: expected vs actual cash per brigade.
// buildReconciliationForBrigadeDay computes expected from finance payments.

import { generateId } from "./masters";
import type { DailyReconciliation } from "@babun/shared/db/types/finance";
import { filterPayments, sumCashCents } from "./payments";

export type { DailyReconciliation };

// ─── Storage ───────────────────────────────────────────────────────────

const RECON_KEY = "babun2:finance:reconciliations";

export function loadReconciliations(): DailyReconciliation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECON_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReconciliations(list: DailyReconciliation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECON_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function getReconciliation(id: string): DailyReconciliation | undefined {
  return loadReconciliations().find((r) => r.id === id);
}

export function getReconciliationForBrigadeDay(
  brigadeId: string,
  date: string
): DailyReconciliation | undefined {
  return loadReconciliations().find(
    (r) => r.brigadeId === brigadeId && r.date === date
  );
}

export function createReconciliation(
  data: Omit<DailyReconciliation, "id" | "createdAt">
): DailyReconciliation {
  const recon: DailyReconciliation = {
    ...data,
    id: generateId("recon"),
    createdAt: new Date().toISOString(),
  };
  const list = loadReconciliations();
  list.push(recon);
  saveReconciliations(list);
  return recon;
}

export function updateReconciliation(
  id: string,
  patch: Partial<Omit<DailyReconciliation, "id" | "createdAt">>
): DailyReconciliation | null {
  const list = loadReconciliations();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], ...patch };
  // Recalculate difference when actual or expected changes.
  updated.differenceCents = updated.actualCashCents - updated.expectedCashCents;
  list[idx] = updated;
  saveReconciliations(list);
  return list[idx];
}

// ─── Build helper ──────────────────────────────────────────────────────

/**
 * Build a draft DailyReconciliation for a brigade-day.
 * Computes expectedCashCents from FinancePayments.
 * actualCashCents is left at 0 for the dispatcher to fill in.
 */
export function buildReconciliationForBrigadeDay(
  brigadeId: string,
  date: string
): DailyReconciliation {
  const dayPayments = filterPayments({
    brigadeId,
    dateFrom: date,
    dateTo: date,
  });

  const expectedCashCents = sumCashCents(dayPayments);
  const appointmentIds = [
    ...new Set(dayPayments.map((p) => p.appointmentId)),
  ];

  return {
    id: generateId("recon"),
    brigadeId,
    date,
    expectedCashCents,
    actualCashCents: 0,
    differenceCents: 0 - expectedCashCents,
    appointmentIds,
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

// ─── Queries ───────────────────────────────────────────────────────────

export function listReconciliationsForBrigade(
  brigadeId: string,
  dateFrom?: string,
  dateTo?: string
): DailyReconciliation[] {
  return loadReconciliations().filter((r) => {
    if (r.brigadeId !== brigadeId) return false;
    if (dateFrom !== undefined && r.date < dateFrom) return false;
    if (dateTo !== undefined && r.date > dateTo) return false;
    return true;
  });
}

/** Total shortage (sum of negative differences) for a brigade in range. */
export function totalShortageCents(brigadeId: string, dateFrom: string, dateTo: string): number {
  const recons = listReconciliationsForBrigade(brigadeId, dateFrom, dateTo);
  return recons.reduce((acc, r) => {
    return r.differenceCents < 0 ? acc + r.differenceCents : acc;
  }, 0);
}
