// Database rows → invoice ledger shapes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type {
  InvoiceKind,
  InvoiceLedger,
  InvoiceLineLedger,
  InvoiceStatus,
  InvoiceVatMode,
} from "../../../local/finance/invoice-ledger";
import {
  parseInvoiceClientSnapshot,
  parseInvoiceSellerSnapshot,
} from "../../../local/finance/invoice-ledger";

export type DbSupabase = SupabaseClient<Database>;
export type Row = Database["public"]["Tables"]["invoices"]["Row"];
export type LineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];

export function rowToInvoice(r: Row): InvoiceLedger {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    number: r.number,
    year: r.year,
    seq: r.seq,
    issued_on: r.issued_on,
    language: r.language ?? "ru",
    due_on: r.due_on,
    client_id: r.client_id,
    appointment_id: r.appointment_id,
    brigade_id: r.brigade_id,
    company_id: r.company_id,
    account_id: r.account_id,
    location_id: r.location_id ?? null,
    client_requisites_id: r.client_requisites_id ?? null,
    subtotal_net: Number(r.subtotal_net ?? 0),
    vat_percent: Number(r.vat_percent ?? 19),
    vat_amount: Number(r.vat_amount ?? 0),
    total: Number(r.total ?? 0),
    currency: r.currency,
    status: r.status as InvoiceStatus,
    // ВИД И РЕЖИМ НДС — С САМОГО ДОКУМЕНТА. Без вида витрины отличали сторно
    // от счёта по минусовой сумме и отдельным запросом связей, а режим НДС
    // угадывали по суммам, хотя сервер его теперь пишет.
    kind: (r.kind as InvoiceKind | null) ?? "invoice",
    credit_note_of_id: r.credit_note_of_id,
    credit_note_of_receipt_id: r.credit_note_of_receipt_id ?? null,
    credited_amount: Number(r.credited_amount ?? 0),
    credit_partial: r.credit_partial ?? false,
    vat_mode: (r.vat_mode as InvoiceVatMode | null) ?? null,
    pdf_url: r.pdf_url,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
    seller_snapshot: parseInvoiceSellerSnapshot(r.seller_snapshot),
    client_snapshot: parseInvoiceClientSnapshot(r.client_snapshot),
  };
}

export function rowToLine(r: LineRow): InvoiceLineLedger {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    position: r.position,
    title: r.title,
    description: r.description ?? null,
    qty: Number(r.qty ?? 1),
    unit: r.unit ?? null,
    unit_price: Number(r.unit_price ?? 0),
    total: Number(r.total ?? 0),
  };
}
