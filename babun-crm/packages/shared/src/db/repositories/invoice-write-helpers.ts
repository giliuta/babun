import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import type { InvoiceLineDraft } from "../../local/finance/invoice-ledger";

type DbSupabase = SupabaseClient<Database>;
type LineInsert = Database["public"]["Tables"]["invoice_lines"]["Insert"];

export function validateInvoiceDraft(draft: {
  issued_on: string;
  due_on?: string | null;
  vat_percent: number;
  lines: InvoiceLineDraft[];
}): InvoiceLineDraft[] {
  assertDate(draft.issued_on, "Дата выставления");
  if (draft.due_on) {
    assertDate(draft.due_on, "Срок оплаты");
    if (draft.due_on < draft.issued_on) {
      throw new Error("Срок оплаты не может быть раньше даты выставления");
    }
  }
  if (
    !Number.isFinite(draft.vat_percent) ||
    draft.vat_percent < 0 ||
    draft.vat_percent > 100 ||
    exactMoneyAmountToCents(draft.vat_percent, { allowZero: true }) == null
  ) {
    throw new Error("VAT должен быть от 0 до 100% и не больше двух знаков");
  }
  if (draft.lines.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  if (draft.lines.length > 100) {
    throw new Error("В инвойсе может быть не больше 100 позиций");
  }

  return draft.lines.map((line) => {
    const title = line.title.trim();
    if (!title) throw new Error("У каждой позиции должно быть название");
    if (title.length > 500) throw new Error("Название позиции слишком длинное");
    if (!Number.isFinite(line.qty) || line.qty <= 0 || line.qty > 100_000) {
      throw new Error(`Некорректное количество: ${title}`);
    }
    if (
      !Number.isFinite(line.unit_price) ||
      line.unit_price < 0 ||
      line.unit_price > 999_999_999 ||
      exactMoneyAmountToCents(line.unit_price, { allowZero: true }) == null
    ) {
      throw new Error(`Некорректная цена или больше двух знаков: ${title}`);
    }
    const qty = roundInvoiceQuantity(line.qty);
    const unitPrice = roundInvoiceMoney(line.unit_price);
    if (qty <= 0) throw new Error(`Количество слишком маленькое: ${title}`);
    if (roundInvoiceMoney(qty * unitPrice) > MAX_INVOICE_MONEY) {
      throw new Error(`Сумма позиции слишком большая: ${title}`);
    }
    return { title, qty, unit_price: unitPrice };
  });
}

export function invoiceLineRows(
  invoiceId: string,
  lines: InvoiceLineDraft[],
): LineInsert[] {
  return lines.map((line, position) => ({
    invoice_id: invoiceId,
    position,
    title: line.title,
    qty: line.qty,
    unit_price: line.unit_price,
    total: roundInvoiceMoney(line.qty * line.unit_price),
  }));
}

export async function cleanupInvoice(
  supabase: DbSupabase,
  id: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  return error || !data ? "; откат инвойса не подтверждён" : "";
}

export const MAX_INVOICE_MONEY = 9_999_999_999.99;

export function assertInvoiceTotal(total: number): void {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Итог инвойса должен быть больше нуля");
  }
  if (total > MAX_INVOICE_MONEY) {
    throw new Error("Итог инвойса слишком большой");
  }
}

export function roundInvoiceMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundInvoiceQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function assertDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field}: ожидается дата ГГГГ-ММ-ДД`);
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${field}: некорректная дата`);
  }
}
