// Finance payments data layer.
//
// FinancePayment is the NEW finance-layer payment record,
// separate from the legacy Payment[] on Appointment (which is kept for
// backwards compat). This module owns the babun2:finance:payments namespace.

import { generateId } from "./masters";
import type { FinancePayment, FinancePaymentMethod } from "@babun/shared/db/types/finance";

export type { FinancePayment, FinancePaymentMethod };

// ─── Storage ───────────────────────────────────────────────────────────

const PAYMENTS_KEY = "babun2:finance:payments";

export function loadPayments(): FinancePayment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PAYMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePayments(list: FinancePayment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAYMENTS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export function getPayment(id: string): FinancePayment | undefined {
  return loadPayments().find((p) => p.id === id);
}

export function createPayment(
  data: Omit<FinancePayment, "id" | "createdAt">
): FinancePayment {
  const now = new Date().toISOString();
  const payment: FinancePayment = {
    ...data,
    id: generateId("fpay"),
    createdAt: now,
  };
  const list = loadPayments();
  list.push(payment);
  savePayments(list);
  return payment;
}

// ─── Filters ───────────────────────────────────────────────────────────

export interface PaymentFilter {
  appointmentId?: string;
  clientId?: string;
  brigadeId?: string;
  /** YYYY-MM-DD inclusive start */
  dateFrom?: string;
  /** YYYY-MM-DD inclusive end */
  dateTo?: string;
  method?: FinancePaymentMethod;
}

export function filterPayments(filter: PaymentFilter): FinancePayment[] {
  const all = loadPayments();
  return all.filter((p) => {
    if (filter.appointmentId !== undefined && p.appointmentId !== filter.appointmentId)
      return false;
    if (filter.clientId !== undefined && p.clientId !== filter.clientId)
      return false;
    if (filter.brigadeId !== undefined && p.brigadeId !== filter.brigadeId)
      return false;
    if (filter.method !== undefined && p.method !== filter.method)
      return false;
    if (filter.dateFrom !== undefined) {
      const pDate = p.paidAt.slice(0, 10);
      if (pDate < filter.dateFrom) return false;
    }
    if (filter.dateTo !== undefined) {
      const pDate = p.paidAt.slice(0, 10);
      if (pDate > filter.dateTo) return false;
    }
    return true;
  });
}

// ─── Sum helpers ───────────────────────────────────────────────────────

/** Sum of amountCents for the given payment list. */
export function sumPaymentsCents(payments: FinancePayment[]): number {
  return payments.reduce((acc, p) => acc + p.amountCents, 0);
}

/** Sum of cash payments (method=cash) only. */
export function sumCashCents(payments: FinancePayment[]): number {
  return payments
    .filter((p) => p.method === "cash")
    .reduce((acc, p) => acc + p.amountCents, 0);
}

/** Sum for a brigade in a date range. */
export function sumBrigadeRevenueCents(
  brigadeId: string,
  dateFrom: string,
  dateTo: string
): number {
  return sumPaymentsCents(filterPayments({ brigadeId, dateFrom, dateTo }));
}
