// Finance & Payroll shared types.
//
// All monetary fields are stored as euro-cents integers.
// e.g. €50.00 → 5000, €1000 → 100000.

// ─── Enums / union types ───────────────────────────────────────────────

export type AppointmentFinanceStatus = "new" | "completed" | "cancelled";

export type AppointmentSource = "manual" | "online" | "waitlist";

export type ExpenseScope = "company" | "brigade" | "appointment";

export type BrigadeType = "internal" | "outsource";

export type FinancePaymentMethod = "cash" | "card" | "transfer" | "split" | "invoice";

export type NotificationKind = "reminder" | "confirmation" | "followup";

export type NotificationChannel = "sms" | "whatsapp" | "telegram" | "email";

export type PayrollPeriodType = "weekly_percent" | "monthly_base";

export type PayrollStatus = "draft" | "approved" | "paid";

export type ExpenseCategory =
  | "lunch"
  | "car_rent"
  | "fuel"
  | "supplies"
  | "salary"
  | "other";

// ─── Service catalog ───────────────────────────────────────────────────

export interface FinanceServiceCategory {
  id: string;
  label: string;
  colorHex: string;
  /** Default duration in minutes for this category. */
  defaultDurationMin: number;
}

export interface FinanceService {
  id: string;
  name: string;
  categoryId: string;
  durationMinutes: number;
  /** Price per unit in euro-cents. */
  unitPriceEur: number;
  isActive: boolean;
}

// ─── Service lines ─────────────────────────────────────────────────────

export interface ServiceLine {
  id: string;
  serviceId: string;
  quantity: number;
  /** Actual charged price per unit in euro-cents (may differ from catalog). */
  unitPriceEur: number;
  /** euro-cents = quantity × unitPriceEur */
  subtotalEur: number;
}

// ─── Brigades ──────────────────────────────────────────────────────────

export interface Brigade {
  id: string;
  name: string;
  type: BrigadeType;
  leadMasterId: string | null;
  helperMasterIds: string[];
  /** euro-cents — fixed cost per job for outsource brigades. */
  perJobCostCents: number;
  isActive: boolean;
  /** Hex color shown on the calendar column header. */
  color?: string;
  createdAt: string;
}

export interface BrigadeMember {
  id: string;
  masterId: string;
  brigadeId: string;
  role: "lead" | "helper";
  /** euro-cents per month base salary. €1000 → 100000. */
  baseMonthlySalaryCents: number;
  /** 0–100. Percentage of brigade post-discount revenue for this person. */
  percentRate: number;
  joinedAt: string;
  leftAt: string | null;
}

// ─── Appointment finance ───────────────────────────────────────────────

export interface AppointmentFinance {
  id: string;
  appointmentId: string;
  brigadeId: string | null;
  serviceLines: ServiceLine[];
  /** 0–100 percentage discount applied to subtotal. */
  discountPercent: number;
  /** euro-cents absolute discount applied after percentage. */
  discountAbsoluteEur: number;
  /** euro-cents = Σ(line.subtotalEur) */
  subtotalEur: number;
  /** euro-cents = round(subtotalEur × discountPercent / 100) + discountAbsoluteEur */
  discountEur: number;
  /** euro-cents = subtotalEur − discountEur, clamped ≥ 0 */
  totalEur: number;
  /** euro-cents — cost charged by outsource brigade for this job. */
  outsourceCostTotalEur: number;
  status: AppointmentFinanceStatus;
  source: AppointmentSource;
  completedAt: string | null;
  createdAt: string;
}

// ─── Payments ──────────────────────────────────────────────────────────

export interface FinancePayment {
  id: string;
  appointmentId: string;
  clientId: string | null;
  brigadeId: string | null;
  /** euro-cents */
  amountCents: number;
  method: FinancePaymentMethod;
  paidAt: string;
  note: string;
  createdAt: string;
}

// ─── Expenses ──────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  scope: ExpenseScope;
  brigadeId: string | null;
  appointmentId: string | null;
  category: ExpenseCategory;
  description: string;
  /** euro-cents */
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  createdAt: string;
}

// ─── Daily reconciliation ──────────────────────────────────────────────

export interface DailyReconciliation {
  id: string;
  brigadeId: string;
  /** YYYY-MM-DD */
  date: string;
  /** euro-cents — expected cash from cash payments on this day. */
  expectedCashCents: number;
  /** euro-cents — cash actually handed in. */
  actualCashCents: number;
  /** euro-cents = actualCashCents − expectedCashCents (negative = shortage). */
  differenceCents: number;
  appointmentIds: string[];
  notes: string;
  createdAt: string;
}

// ─── Payroll ───────────────────────────────────────────────────────────

export interface PayrollLine {
  id: string;
  periodId: string;
  masterId: string;
  brigadeId: string;
  type: PayrollPeriodType;
  /** euro-cents */
  amountCents: number;
  description: string;
}

export interface PayrollPeriod {
  id: string;
  brigadeId: string;
  /** YYYY-MM-DD */
  periodStart: string;
  /** YYYY-MM-DD */
  periodEnd: string;
  type: PayrollPeriodType;
  lines: PayrollLine[];
  /** euro-cents = Σ(line.amountCents) */
  totalCents: number;
  status: PayrollStatus;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ─── Notifications ─────────────────────────────────────────────────────

export interface NotificationTemplate {
  id: string;
  kind: NotificationKind;
  channel: NotificationChannel;
  /**
   * Template text with placeholders:
   * {clientName} {serviceList} {date} {time} {address} {brigadeName} {totalEur}
   */
  templateText: string;
  /** Hours before appointment to send. */
  offsetHoursBefore: number;
  enabled: boolean;
  createdAt: string;
}

// ─── Notification render context ───────────────────────────────────────

export interface NotificationContext {
  clientName?: string;
  serviceList?: string;
  date?: string;
  time?: string;
  address?: string;
  brigadeName?: string;
  /** Human-readable total, e.g. "€50.00" */
  totalEur?: string;
}
