// Invoices repository — the platform-neutral ledger API used by mobile.
// Creation, numbering and editing are atomic database RPCs; the RN client
// performs validation too, then confirms the committed document by reading it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import type {
  InvoiceLedger,
  InvoiceLedgerWithLines,
  InvoiceLineLedger,
  InvoiceLineDraft,
  InvoiceStatus,
  InvoiceVatMode,
} from "../../local/finance/invoice-ledger";
import {
  calculateInvoiceTotals,
  parseInvoiceClientSnapshot,
  parseInvoiceSellerSnapshot,
} from "../../local/finance/invoice-ledger";
import {
  assertInvoiceTotal,
  roundInvoiceMoney,
  validateInvoiceDraft,
} from "./invoice-write-helpers";

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
const INVOICE_PAGE_SIZE = 1000;

export interface IssueInvoiceDraft {
  request_id: string;
  issued_on: string;
  due_on?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  brigade_id?: string | null;
  vat_mode: InvoiceVatMode;
  vat_percent: number;
  lines: InvoiceLineDraft[];
  notes?: string | null;
  link_to_tx_id?: string | null;
}

export interface EditInvoiceDraft {
  due_on?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  brigade_id?: string | null;
  vat_mode: InvoiceVatMode;
  vat_percent: number;
  lines: InvoiceLineDraft[];
  notes?: string | null;
}

function rowToInvoice(r: Row): InvoiceLedger {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    number: r.number,
    year: r.year,
    seq: r.seq,
    issued_on: r.issued_on,
    due_on: r.due_on,
    client_id: r.client_id,
    appointment_id: r.appointment_id,
    brigade_id: r.brigade_id,
    subtotal_net: Number(r.subtotal_net ?? 0),
    vat_percent: Number(r.vat_percent ?? 19),
    vat_amount: Number(r.vat_amount ?? 0),
    total: Number(r.total ?? 0),
    currency: r.currency,
    status: r.status as InvoiceStatus,
    pdf_url: r.pdf_url,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
    seller_snapshot: parseInvoiceSellerSnapshot(r.seller_snapshot),
    client_snapshot: parseInvoiceClientSnapshot(r.client_snapshot),
  };
}

function rowToLine(r: LineRow): InvoiceLineLedger {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    position: r.position,
    title: r.title,
    qty: Number(r.qty ?? 1),
    unit_price: Number(r.unit_price ?? 0),
    total: Number(r.total ?? 0),
  };
}

export async function listInvoices(
  supabase: DbSupabase,
  tenantId: string,
  opts: { limit?: number; clientId?: string } = {},
): Promise<InvoiceLedger[]> {
  const requestedLimit = opts.limit == null
    ? null
    : Math.max(0, Math.floor(opts.limit));
  if (requestedLimit === 0) return [];

  const rows: Row[] = [];
  for (let offset = 0; ; offset += INVOICE_PAGE_SIZE) {
    const remaining = requestedLimit == null
      ? INVOICE_PAGE_SIZE
      : Math.min(INVOICE_PAGE_SIZE, requestedLimit - rows.length);
    if (remaining <= 0) break;
    let q = supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId);
    if (opts.clientId) q = q.eq("client_id", opts.clientId);
    const { data, error } = await q
      .order("year", { ascending: false })
      .order("seq", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + remaining - 1);
    if (error) throw new Error(`listInvoices: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < remaining) break;
  }
  return rows.map(rowToInvoice);
}

/** Atomically allocate a number, create the invoice and optionally link income. */
export async function issueInvoice(
  supabase: DbSupabase,
  tenantId: string,
  draft: IssueInvoiceDraft,
): Promise<InvoiceLedgerWithLines> {
  const lines = validateInvoiceDraft(draft);
  const totals = calculateInvoiceTotals(lines, draft.vat_mode, draft.vat_percent);
  assertInvoiceTotal(totals.total);
  const { data, error } = await supabase.rpc("issue_invoice", {
    p_request_id: draft.request_id,
    p_issued_on: draft.issued_on,
    p_due_on: draft.due_on ?? null,
    p_client_id: draft.client_id ?? null,
    p_appointment_id: draft.appointment_id ?? null,
    p_brigade_id: draft.brigade_id ?? null,
    p_vat_mode: draft.vat_mode,
    p_vat_percent: draft.vat_percent,
    p_lines: lines.map((line) => ({
      title: line.title,
      qty: line.qty,
      unit_price: line.unit_price,
    })),
    p_notes: draft.notes?.trim() || null,
    p_link_to_tx_id: draft.link_to_tx_id ?? null,
  });
  if (error || !data || data.id !== draft.request_id || data.tenant_id !== tenantId) {
    throw new Error(`issueInvoice: ${error?.message ?? "создание не подтверждено сервером"}`);
  }
  if (draft.link_to_tx_id && data.status !== "paid") {
    throw new Error("Инвойс создан, но оплата доходом не подтверждена");
  }
  const saved = await getInvoice(supabase, data.id);
  if (!saved) {
    throw new Error("Инвойс создан, но контрольное чтение не подтверждено");
  }
  assertInvoiceControlRead(saved, lines, totals, {
    issuedOn: draft.issued_on,
    dueOn: draft.due_on ?? null,
    clientId: draft.client_id ?? null,
    appointmentId: draft.appointment_id ?? null,
    brigadeId: draft.brigade_id ?? null,
    notes: draft.notes ?? null,
    vatMode: draft.vat_mode,
    vatPercent: draft.vat_percent,
    allowResolvedReferences: !!draft.link_to_tx_id,
  });
  return saved;
}

export async function getInvoice(
  supabase: DbSupabase,
  id: string,
): Promise<InvoiceLedgerWithLines | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getInvoice: ${error.message}`);
  if (!data) return null;
  const { data: lines, error: linesErr } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", id)
    .order("position", { ascending: true });
  if (linesErr) throw new Error(`getInvoice (lines): ${linesErr.message}`);
  return {
    ...rowToInvoice(data as Row),
    lines: ((lines ?? []) as LineRow[]).map(rowToLine),
  };
}

export async function updateInvoiceStatus(
  supabase: DbSupabase,
  id: string,
  status: InvoiceStatus,
): Promise<void> {
  if (status !== "void") {
    throw new Error("Статус оплаты изменяется только подтверждённым платежом");
  }
  const { data, error } = await supabase.rpc("void_invoice", {
    p_invoice_id: id,
  });
  if (error || !data || data.id !== id || data.status !== "void") {
    throw new Error(
      `updateInvoiceStatus: ${error?.message ?? "аннулирование не подтверждено сервером"}`,
    );
  }
}

/** Edit an unpaid invoice atomically under the database invoice-row lock. */
export async function updateInvoice(
  supabase: DbSupabase,
  id: string,
  issuedOn: string,
  draft: EditInvoiceDraft,
): Promise<InvoiceLedgerWithLines> {
  const lines = validateInvoiceDraft({ ...draft, issued_on: issuedOn });
  const totals = calculateInvoiceTotals(lines, draft.vat_mode, draft.vat_percent);
  assertInvoiceTotal(totals.total);
  const { data, error } = await supabase.rpc("update_invoice_draft", {
    p_invoice_id: id,
    p_due_on: draft.due_on ?? null,
    p_client_id: draft.client_id ?? null,
    p_appointment_id: draft.appointment_id ?? null,
    p_brigade_id: draft.brigade_id ?? null,
    p_vat_mode: draft.vat_mode,
    p_vat_percent: draft.vat_percent,
    p_lines: lines.map((line) => ({
      title: line.title,
      qty: line.qty,
      unit_price: line.unit_price,
    })),
    p_notes: draft.notes?.trim() || null,
  });
  if (error || !data || data.id !== id || data.status !== "issued") {
    throw new Error(
      `updateInvoice: ${error?.message ?? "сохранение не подтверждено сервером"}`,
    );
  }
  const saved = await getInvoice(supabase, id);
  if (!saved) {
    throw new Error("Инвойс сохранён, но контрольное чтение не подтверждено");
  }
  assertInvoiceControlRead(saved, lines, totals, {
    issuedOn,
    dueOn: draft.due_on ?? null,
    clientId: draft.client_id ?? null,
    appointmentId: draft.appointment_id ?? null,
    brigadeId: draft.brigade_id ?? null,
    notes: draft.notes ?? null,
    vatMode: draft.vat_mode,
    vatPercent: draft.vat_percent,
    allowResolvedReferences: false,
  });
  return saved;
}

function assertInvoiceControlRead(
  saved: InvoiceLedgerWithLines,
  lines: InvoiceLineDraft[],
  totals: { subtotal_net: number; vat_amount: number; total: number },
  expected: {
    issuedOn: string;
    dueOn: string | null;
    clientId: string | null;
    appointmentId: string | null;
    brigadeId: string | null;
    notes: string | null;
    vatMode: InvoiceVatMode;
    vatPercent: number;
    allowResolvedReferences: boolean;
  },
): void {
  const expectedVat = expected.vatMode === "off"
    ? 0
    : roundInvoiceMoney(expected.vatPercent);
  const headerMatches =
    saved.issued_on === expected.issuedOn &&
    saved.due_on === expected.dueOn &&
    saved.notes === (expected.notes?.trim() || null) &&
    moneyEqual(saved.subtotal_net, totals.subtotal_net) &&
    moneyEqual(saved.vat_amount, totals.vat_amount) &&
    moneyEqual(saved.total, totals.total) &&
    moneyEqual(saved.vat_percent, expectedVat);
  const referencesMatch = expected.allowResolvedReferences
    ? (expected.clientId === null || saved.client_id === expected.clientId) &&
      (expected.appointmentId === null || saved.appointment_id === expected.appointmentId) &&
      (expected.brigadeId === null || saved.brigade_id === expected.brigadeId)
    : saved.client_id === expected.clientId &&
      saved.appointment_id === expected.appointmentId &&
      saved.brigade_id === expected.brigadeId;
  const linesMatch =
    saved.lines.length === lines.length &&
    saved.lines.every((line, index) => {
      const expectedLine = lines[index];
      return line.position === index &&
        line.title === expectedLine.title &&
        Math.abs(line.qty - expectedLine.qty) < 0.0005 &&
        moneyEqual(line.unit_price, expectedLine.unit_price) &&
        moneyEqual(
          line.total,
          roundInvoiceMoney(expectedLine.qty * expectedLine.unit_price),
        );
    });

  if (!headerMatches || !referencesMatch || !linesMatch) {
    throw new Error(
      "Контрольное чтение инвойса не совпало с отправленным документом",
    );
  }
}

function moneyEqual(left: number, right: number): boolean {
  return Math.abs(roundInvoiceMoney(left) - roundInvoiceMoney(right)) < 0.005;
}

export async function setInvoicePdfUrl(
  supabase: DbSupabase,
  id: string,
  pdfPath: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("invoices")
    .update({ pdf_url: pdfPath })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`setInvoicePdfUrl: ${error?.message ?? "инвойс недоступен"}`);
  }
}
