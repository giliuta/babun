import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { rpcArgs } from "../rpc-args";
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

/** Ровно те колонки, что нужны InvoicePaymentLedger: остальная строка журнала
 *  (снимок НДС, заметки триггеров, receipt_url…) в оплатах инвойса не
 *  используется и раньше гоняла `select *` по всей истории тенанта. */
const PAYMENT_COLUMNS =
  "id, invoice_id, type, amount, account_id, payment_method, occurred_on, " +
  "refund_of_id, notes, created_at, source, appointment_payment_kind";

type PaymentRow = Pick<
  TransactionRow,
  | "id"
  | "invoice_id"
  | "type"
  | "amount"
  | "account_id"
  | "payment_method"
  | "occurred_on"
  | "refund_of_id"
  | "notes"
  | "created_at"
  | "source"
  | "appointment_payment_kind"
>;

/** Keyset-страница (.gt по id): набор растёт, и offset-окно range при
 *  конкурентной вставке задваивало бы или пропускало строку. Сортировка для
 *  экрана здесь не нужна — итоговый список каждого инвойса сортируется ниже. */
async function pagePayments(
  supabase: DbSupabase,
  tenantId: string,
  scope: "invoice-linked" | "orphan-refunds",
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  let lastId: string | null = null;
  for (;;) {
    const base = supabase
      .from("finance_transactions")
      .select(PAYMENT_COLUMNS)
      .eq("tenant_id", tenantId);
    let q =
      scope === "invoice-linked"
        ? base.not("invoice_id", "is", null).in("type", ["income", "refund"])
        : base
            .eq("type", "refund")
            .is("invoice_id", null)
            .not("refund_of_id", "is", null);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(`listInvoicePayments: ${error.message}`);
    const page = (data ?? []) as unknown as PaymentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }
  return rows;
}

export async function listInvoicePayments(
  supabase: DbSupabase,
  tenantId: string,
): Promise<InvoicePaymentsById> {
  const direct = await pagePayments(supabase, tenantId, "invoice-linked");

  const incomeInvoice = new Map<string, string>();
  for (const row of direct) {
    if (row.type === "income" && row.invoice_id) {
      incomeInvoice.set(row.id, row.invoice_id);
    }
  }

  // Легаси-возвраты несут только refund_of_id. Раньше они догружались
  // чанками `.in()` по 100 income-id — при 500 оплаченных инвойсах это 5+
  // последовательных запросов. Один keyset-скан всех «сиротских» возвратов
  // дешевле: набор ограничен эпохой до простановки invoice_id и не растёт,
  // а чужие возвраты отсеивает та же карта income → invoice.
  const externalRefunds: Array<{ row: PaymentRow; invoiceId: string }> = [];
  if (incomeInvoice.size > 0) {
    const orphans = await pagePayments(supabase, tenantId, "orphan-refunds");
    for (const row of orphans) {
      const invoiceId = row.refund_of_id
        ? incomeInvoice.get(row.refund_of_id)
        : undefined;
      if (invoiceId) externalRefunds.push({ row, invoiceId });
    }
  }

  const result: InvoicePaymentsById = {};
  const add = (row: PaymentRow, invoiceId: string) => {
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
  const { data, error } = await supabase.rpc(
    "record_invoice_payment",
    rpcArgs<"record_invoice_payment">({
      p_invoice_id: invoiceId,
      p_request_id: draft.request_id,
      p_amount: amount,
      p_account_id: draft.account_id,
      p_payment_method: draft.payment_method,
      p_occurred_on: draft.occurred_on,
      p_notes: draft.notes?.trim() || null,
    }),
  );
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
  const { data, error } = await supabase.rpc(
    "refund_invoice_payment",
    rpcArgs<"refund_invoice_payment">({
      p_payment_id: paymentId,
      p_request_id: draft.request_id,
      p_amount: amount,
      p_occurred_on: draft.occurred_on,
      p_notes: draft.notes?.trim() || null,
    }),
  );
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
  row: PaymentRow,
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
