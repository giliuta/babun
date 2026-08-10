// DB-backed invoice types (the new server-issued, atomically-numbered
// invoice flow). Distinct from the existing local/finance/invoice.ts
// which is the legacy localStorage-era jsPDF generator — these are the
// authoritative records that live in the public.invoices table.

/** `cancelled` — сторнирован кредит-нотой (2026-08-09); `void` остаётся
 *  легаси-статусом «внутренне аннулирован» и не переиспользуется:
 *  «удалили по ошибке» и «сторнировали документом» — разные события. */
export type InvoiceStatus = "issued" | "paid" | "void" | "cancelled";
export type InvoiceDisplayStatus = InvoiceStatus | "partial" | "overdue";
export type InvoiceVatMode = "off" | "inclusive" | "exclusive";

export interface InvoiceLineDraft {
  title: string;
  qty: number;
  unit_price: number;
}

export interface InvoiceTotals {
  subtotal_net: number;
  vat_amount: number;
  total: number;
}

export interface InvoicePaymentLedger {
  id: string;
  invoice_id: string;
  type: "income" | "refund";
  amount: number;
  account_id: string | null;
  payment_method: string | null;
  occurred_on: string;
  refund_of_id: string | null;
  notes: string | null;
  created_at: string;
  source?: string;
  appointment_payment_kind?: string | null;
}

export type InvoicePaymentRefundDestination = "invoice" | "appointment" | null;

export interface InvoiceSettlement {
  income: number;
  refunded: number;
  paid: number;
  remaining: number;
  overpaid: number;
  isPartial: boolean;
  isPaid: boolean;
}

/** Immutable legal party copied by the database when the invoice is issued. */
export interface InvoiceSellerSnapshot {
  schema_version: number;
  tenant_id: string | null;
  name: string | null;
  display_name: string | null;
  legal_name: string | null;
  vat_number: string | null;
  business_address: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  iban: string | null;
  bank_name: string | null;
  /** Логотип на момент выставления. null у документов, выписанных до того,
   *  как логотип начали печатать. */
  logo_url?: string | null;
  currency: string | null;
}

/** Immutable recipient copied by the database, including archive state then. */
export interface InvoiceClientSnapshot {
  schema_version: number;
  client_id: string | null;
  full_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  primary_address: string | null;
  archived: boolean;
  deleted_at: string | null;
}

export interface InvoiceLedger {
  id: string;
  tenant_id: string;
  number: string; // e.g. "INV-2026-001"
  year: number;
  seq: number;
  issued_on: string; // YYYY-MM-DD
  due_on: string | null;
  client_id: string | null;
  appointment_id: string | null;
  brigade_id: string | null;
  subtotal_net: number;
  vat_percent: number;
  vat_amount: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  pdf_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Optional in the domain shape so pre-migration offline fixtures still read. */
  seller_snapshot?: InvoiceSellerSnapshot | null;
  client_snapshot?: InvoiceClientSnapshot | null;
}

export interface InvoiceLineLedger {
  id: string;
  invoice_id: string;
  position: number;
  title: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface InvoiceLedgerWithLines extends InvoiceLedger {
  lines: InvoiceLineLedger[];
}

export function formatInvoiceNumber(
  prefix: string,
  year: number,
  seq: number,
): string {
  const normalized = prefix.trim().replace(/[\s-]+$/g, "") || "INV";
  return `${normalized}-${year}-${String(seq).padStart(3, "0")}`;
}

/**
 * Split a gross total into net + VAT. Cyprus standard is 19%. We treat
 * the input as the customer-facing total (VAT-inclusive) — the most
 * common case at the till.
 */
export function splitVatInclusive(
  total: number,
  vatPercent: number,
): { net: number; vat: number } {
  const factor = 1 + vatPercent / 100;
  const net = total / factor;
  return { net: round2(net), vat: round2(total - net) };
}

/**
 * Canonical invoice arithmetic. Values stay in decimal euros because the
 * existing database schema is numeric(12,2); every boundary is rounded to
 * cents so UI previews and persisted totals cannot drift by floating-point
 * dust. Invalid/negative inputs are rejected by the repository before this
 * helper is called.
 */
export function calculateInvoiceTotals(
  lines: readonly InvoiceLineDraft[],
  vatMode: InvoiceVatMode,
  vatPercent: number,
): InvoiceTotals {
  const base = round2(
    lines.reduce((sum, line) => sum + round2(line.qty * line.unit_price), 0),
  );

  if (vatMode === "off" || vatPercent <= 0) {
    return { subtotal_net: base, vat_amount: 0, total: base };
  }

  if (vatMode === "inclusive") {
    const { net, vat } = splitVatInclusive(base, vatPercent);
    return { subtotal_net: net, vat_amount: vat, total: base };
  }

  const vat = round2(base * (vatPercent / 100));
  return {
    subtotal_net: base,
    vat_amount: vat,
    total: round2(base + vat),
  };
}

/** `overdue` is a view state: the database keeps the legal status `issued`. */
export function invoiceDisplayStatus(
  invoice: Pick<InvoiceLedger, "status" | "due_on">,
  today = localDateKey(new Date()),
  settlement?: Pick<InvoiceSettlement, "isPaid" | "isPartial">,
): InvoiceDisplayStatus {
  if (invoice.status === "void") return "void";
  if (settlement?.isPaid) return "paid";
  if (settlement?.isPartial) return "partial";
  if (
    invoice.status === "issued" &&
    invoice.due_on &&
    invoice.due_on < today
  ) {
    return "overdue";
  }
  return invoice.status;
}

/**
 * Summarise every ledger row attached to an invoice. A legacy `paid` invoice
 * is treated as fully paid even when it predates payment rows; real refunds
 * still reopen the balance because they are subtracted after that fallback.
 */
export function calculateInvoiceSettlement(
  invoice: Pick<InvoiceLedger, "status" | "total">,
  payments: readonly InvoicePaymentLedger[],
): InvoiceSettlement {
  const income = round2(
    payments.reduce(
      (sum, payment) =>
        payment.type === "income" ? sum + Math.max(0, payment.amount) : sum,
      0,
    ),
  );
  const refunded = round2(
    payments.reduce(
      (sum, payment) =>
        payment.type === "refund" ? sum + Math.abs(payment.amount) : sum,
      0,
    ),
  );
  const recognizedIncome =
    invoice.status === "paid" ? Math.max(invoice.total, income) : income;
  const rawPaid = round2(Math.max(0, recognizedIncome - refunded));
  const paid = round2(Math.min(invoice.total, rawPaid));
  const overpaid = round2(Math.max(0, rawPaid - invoice.total));
  const remaining =
    invoice.status === "void"
      ? 0
      : round2(Math.max(0, invoice.total - paid));
  return {
    income,
    refunded,
    paid,
    remaining,
    overpaid,
    isPartial: invoice.status !== "void" && paid > 0 && remaining > 0,
    isPaid: invoice.status !== "void" && remaining <= 0,
  };
}

/**
 * Amount still refundable for one concrete income payment. Refund rows that
 * belong to other payments never reduce this value.
 */
export function calculateInvoicePaymentRefundable(
  payment: InvoicePaymentLedger,
  payments: readonly InvoicePaymentLedger[],
): number {
  if (payment.type !== "income") return 0;
  const original = round2(Math.max(0, payment.amount));
  const refunded = round2(
    payments.reduce(
      (sum, row) =>
        row.type === "refund" && row.refund_of_id === payment.id
          ? sum + Math.abs(row.amount)
          : sum,
      0,
    ),
  );
  return round2(Math.max(0, original - refunded));
}

/**
 * Route a refund to the writer that owns all affected state. Appointment
 * receipts must update the appointment mirrors and ledger atomically; manual
 * invoice receipts can use the invoice refund RPC directly.
 */
export function invoicePaymentRefundDestination(
  payment: InvoicePaymentLedger,
  payments: readonly InvoicePaymentLedger[],
): InvoicePaymentRefundDestination {
  if (calculateInvoicePaymentRefundable(payment, payments) <= 0) return null;
  if (payment.source === "auto" || payment.appointment_payment_kind != null) {
    return "appointment";
  }
  return "invoice";
}

export function parseInvoiceSellerSnapshot(
  value: unknown,
): InvoiceSellerSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    tenant_id: stringValue(row.tenant_id),
    name: stringValue(row.name),
    display_name: stringValue(row.display_name),
    legal_name: stringValue(row.legal_name),
    vat_number: stringValue(row.vat_number),
    business_address: stringValue(row.business_address),
    address: stringValue(row.address),
    city: stringValue(row.city),
    country: stringValue(row.country),
    contact_email: stringValue(row.contact_email),
    contact_phone: stringValue(row.contact_phone),
    iban: stringValue(row.iban),
    bank_name: stringValue(row.bank_name),
    currency: stringValue(row.currency),
  };
}

export function parseInvoiceClientSnapshot(
  value: unknown,
): InvoiceClientSnapshot | null {
  const row = asObject(value);
  if (!row) return null;
  return {
    schema_version: numberValue(row.schema_version) ?? 1,
    client_id: stringValue(row.client_id),
    full_name: stringValue(row.full_name),
    phone: stringValue(row.phone),
    phone_e164: stringValue(row.phone_e164),
    whatsapp_phone: stringValue(row.whatsapp_phone),
    email: stringValue(row.email),
    address: stringValue(row.address),
    city: stringValue(row.city),
    primary_address: stringValue(row.primary_address),
    archived: row.archived === true,
    deleted_at: stringValue(row.deleted_at),
  };
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  issued: "Выставлен",
  partial: "Частично оплачен",
  overdue: "Просрочен",
  paid: "Оплачен",
  void: "Аннулирован",
  // Сторнирован встречным документом: у клиента на руках и инвойс, и
  // кредит-нота, поэтому слово другое — «отменён», а не «аннулирован».
  cancelled: "Отменён",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
