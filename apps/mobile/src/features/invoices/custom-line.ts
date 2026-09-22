import { invoiceLineTotal } from "@babun/shared/local/finance/invoice-ledger";
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { parseDecimal, parseMoneyAmount } from "./format";

// СВОЯ УСЛУГА ПРЯМО В БЛОКЕ — ВЗАИМНЫЙ ПЕРЕСЧЁТ ПОЛЕЙ.
//
// Владелец 2026-09-22: «„＋ Добавить“ возле „Услуги“, и сразу внизу пишу
// услугу, количество, цену за штуку и сумму — взаимозаменяемо». Правило одно:
//   • меняешь количество или цену за штуку — сумма = количество × цена;
//   • меняешь сумму — цена за штуку = сумма / количество (до центов).
// Сервер хранит цену за штуку с двумя знаками и сам умножает, поэтому «€100
// за 3» честно выходит €99,99 — сумма в поле показывает то, что выйдет.

export interface CustomLineNumbers {
  qty: string;
  unitPrice: string;
}

/** Сумма строки для поля «Сумма»: пусто, пока не хватает чисел. */
export function customLineTotalText(line: CustomLineNumbers): string {
  const qty = parseDecimal(line.qty);
  const price = parseMoneyAmount(line.unitPrice);
  return qty != null && price != null ? formatMoneyForInput(invoiceLineTotal(qty, price)) : "";
}

/** Набранная сумма → цена за штуку (количество не трогаем). */
export function unitPriceFromTotal(qtyText: string, totalText: string): string | null {
  const qty = parseDecimal(qtyText);
  const total = parseMoneyAmount(totalText);
  if (!qty || qty <= 0 || total == null) return null;
  return formatMoneyForInput(Math.round((total / qty) * 100) / 100);
}
