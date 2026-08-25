import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { exactMoneyAmountToCents } from "../../common/utils/money";
import {
  invoiceLineTotal,
  invoiceQuantityToThousandths,
  type InvoiceLineDraft,
} from "../../local/finance/invoice-ledger";
import { centsToMoney, moneyToCents } from "../../local/finance/vat";

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
    if (invoiceLineTotal(qty, unitPrice) > MAX_INVOICE_MONEY) {
      throw new Error(`Сумма позиции слишком большая: ${title}`);
    }
    const description = line.description?.trim() || null;
    if (description && description.length > 2000) {
      throw new Error(`Описание позиции слишком длинное: ${title}`);
    }
    // ЕДИНИЦА — СЛОВО, А НЕ ЧИСЛО, поэтому у неё своя проверка: короткая
    // подпись из библиотеки, а не место для второго названия позиции.
    const unit = line.unit?.trim() || null;
    if (unit && unit.length > 16) {
      throw new Error(`Единица измерения слишком длинная: ${title}`);
    }
    return { title, qty, unit_price: unitPrice, description, unit };
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
    description: line.description ?? null,
    qty: line.qty,
    unit: line.unit ?? null,
    unit_price: line.unit_price,
    // ТОТ ЖЕ СЧЁТ, ЧТО У ЭКРАНА И У СЕРВЕРА: `qty * unit_price` в double на
    // дробном количестве промахивается мимо `round(qty * unit_price, 2)` на
    // numeric ровно на цент (1,5 × 2,01).
    total: invoiceLineTotal(line.qty, line.unit_price),
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

/** ОДНО ПРАВИЛО ОКРУГЛЕНИЯ ДЕНЕГ НА ПРОДУКТ: половина уходит ОТ НУЛЯ, как
 *  `round(..., 2)` на `numeric`. Своя формула здесь роняла ровную половину
 *  цента вниз и расходилась с тем, что записал сервер. */
export function roundInvoiceMoney(value: number): number {
  return centsToMoney(moneyToCents(value));
}

/** Количество до трёх знаков — ровно так, как его понимает и умножение
 *  строки, и сервер. */
function roundInvoiceQuantity(value: number): number {
  return invoiceQuantityToThousandths(value) / 1000;
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
