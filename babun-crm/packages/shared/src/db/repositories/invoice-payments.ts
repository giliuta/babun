import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type { InvoicePaymentLedger } from "../../local/finance/invoice-ledger";
import { roundInvoiceMoney } from "./invoice-write-helpers";

type DbSupabase = SupabaseClient<Database>;
type TransactionRow = Database["public"]["Tables"]["finance_transactions"]["Row"];

export type InvoicePaymentsById = Record<string, InvoicePaymentLedger[]>;

export interface RecordInvoicePaymentDraft {
  request_id: string;
  amount: number;
  account_id: string;
  payment_method: "cash" | "card" | "transfer" | "other";
  occurred_on: string;
  /** Tenant-timezone date used for an immediate client-side future guard. */
  business_today: string;
  notes?: string | null;
}

export interface RefundInvoicePaymentDraft {
  request_id: string;
  amount: number;
  occurred_on: string;
  /** Tenant-timezone date used for an immediate client-side future guard. */
  business_today: string;
  /** Client-side chronology check; the server rechecks the locked income. */
  original_occurred_on: string;
  notes?: string | null;
}

const PAGE_SIZE = 1000;
const REFUND_CHUNK_SIZE = 100;

export async function listInvoicePayments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<InvoicePaymentsById> {
  const direct: TransactionRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .not("invoice_id", "is", null)
      .in("type", ["income", "refund"])
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`listInvoicePayments: ${error.message}`);
    const page = (data ?? []) as TransactionRow[];
    direct.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const incomeInvoice = new Map<string, string>();
  for (const row of direct) {
    if (row.type === "income" && row.invoice_id) {
      incomeInvoice.set(row.id, row.invoice_id);
    }
  }

  // Legacy refunds may only have refund_of_id. Fetch them in bounded chunks
  // and attribute them to the original income's invoice.
  const externalRefunds: Array<{ row: TransactionRow; invoiceId: string }> = [];
  const incomeIds = [...incomeInvoice.keys()];
  for (let start = 0; start < incomeIds.length; start += REFUND_CHUNK_SIZE) {
    const ids = incomeIds.slice(start, start + REFUND_CHUNK_SIZE);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("type", "refund")
        .is("invoice_id", null)
        .in("refund_of_id", ids)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`listInvoicePayments (refunds): ${error.message}`);
      const page = (data ?? []) as TransactionRow[];
      for (const row of page) {
        const invoiceId = row.refund_of_id
          ? incomeInvoice.get(row.refund_of_id)
          : undefined;
        if (invoiceId) externalRefunds.push({ row, invoiceId });
      }
      if (page.length < PAGE_SIZE) break;
    }
  }

  const result: InvoicePaymentsById = {};
  const add = (row: TransactionRow, invoiceId: string) => {
    if (row.type !== "income" && row.type !== "refund") return;
    const payment = rowToPayment(row, invoiceId);
    (result[invoiceId] ??= []).push(payment);
  };
  for (const row of direct) {
    if (row.invoice_id) add(row, row.invoice_id);
  }
  for (const { row, invoiceId } of externalRefunds) add(row, invoiceId);
  for (const rows of Object.values(result)) {
    rows.sort((a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      b.created_at.localeCompare(a.created_at) ||
      b.id.localeCompare(a.id),
    );
  }
  return result;
}

export async function recordInvoicePayment(
  supabase: DbSupabase,
  invoiceId: string,
  draft: RecordInvoicePaymentDraft,
): Promise<InvoicePaymentLedger> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
    throw new Error("Сумма платежа должна быть больше нуля");
  }
  const amount = roundInvoiceMoney(draft.amount);
  if (Math.abs(amount - draft.amount) >= 0.000001) {
    throw new Error("Укажите не больше двух знаков после запятой");
  }
  assertOccurredOn(draft.occurred_on, draft.business_today, "платежа");
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoiceId,
    p_request_id: draft.request_id,
    p_amount: amount,
    p_account_id: draft.account_id,
    p_payment_method: draft.payment_method,
    p_occurred_on: draft.occurred_on,
    p_notes: draft.notes?.trim() || null,
  });
  if (error) throw new Error(`recordInvoicePayment: ${error.message}`);
  if (
    !data
    || data.id !== draft.request_id
    || data.invoice_id !== invoiceId
    || data.account_id !== draft.account_id
    || data.payment_method !== draft.payment_method
    || data.occurred_on !== draft.occurred_on
    || Math.abs(Number(data.amount) - amount) >= 0.005
  ) {
    throw new Error("Платёж не подтверждён сервером");
  }
  if (data.type !== "income" || data.source !== "manual") {
    throw new Error("Сервер вернул некорректный платёж");
  }
  return rowToPayment(data as TransactionRow, invoiceId);
}

/**
 * Refund one concrete invoice income. The server locks that income and its
 * invoice, enforces the remaining refundable amount, and copies the original
 * account/team/method instead of trusting client-supplied routing fields.
 */
export async function refundInvoicePayment(
  supabase: DbSupabase,
  invoiceId: string,
  paymentId: string,
  draft: RefundInvoicePaymentDraft,
): Promise<InvoicePaymentLedger> {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
    throw new Error("Сумма возврата должна быть больше нуля");
  }
  const amount = roundInvoiceMoney(draft.amount);
  if (Math.abs(amount - draft.amount) >= 0.000001) {
    throw new Error("Укажите не больше двух знаков после запятой");
  }
  assertOccurredOn(draft.occurred_on, draft.business_today, "возврата");
  if (draft.occurred_on < draft.original_occurred_on) {
    throw new Error("Возврат не может быть раньше исходного платежа");
  }
  const { data, error } = await supabase.rpc("refund_invoice_payment", {
    p_payment_id: paymentId,
    p_request_id: draft.request_id,
    p_amount: amount,
    p_occurred_on: draft.occurred_on,
    p_notes: draft.notes?.trim() || null,
  });
  if (error) throw new Error(`refundInvoicePayment: ${error.message}`);
  if (
    !data ||
    data.id !== draft.request_id ||
    data.type !== "refund" ||
    data.source !== "manual" ||
    data.invoice_id !== invoiceId ||
    data.refund_of_id !== paymentId ||
    data.occurred_on !== draft.occurred_on ||
    Math.abs(Math.abs(Number(data.amount)) - amount) >= 0.005
  ) {
    throw new Error("Возврат не подтверждён сервером");
  }
  return rowToPayment(data as TransactionRow, invoiceId);
}

function rowToPayment(
  row: TransactionRow,
  invoiceId: string,
): InvoicePaymentLedger {
  return {
    id: row.id,
    invoice_id: invoiceId,
    type: row.type as "income" | "refund",
    amount: Number(row.amount ?? 0),
    account_id: row.account_id,
    payment_method: row.payment_method,
    occurred_on: row.occurred_on,
    refund_of_id: row.refund_of_id,
    notes: row.notes,
    created_at: row.created_at,
    source: row.source,
    appointment_payment_kind: row.appointment_payment_kind,
  };
}

function assertOccurredOn(value: string, businessToday: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !/^\d{4}-\d{2}-\d{2}$/.test(businessToday)) {
    throw new Error(`Укажите дату ${label}`);
  }
  if (value > businessToday) {
    throw new Error(`Дата ${label} не может быть в будущем`);
  }
}
