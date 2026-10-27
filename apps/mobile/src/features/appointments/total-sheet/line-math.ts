// Pure money of one «Итого» row.

/** Price of one piece from a typed row sum: the row keeps the unit price and
 *  its total is price × quantity, so a typed sum is divided back. */
export function unitFromRowTotal(total: number, qty: number): number {
  const q = Math.max(1, qty);
  return Math.round((total / q) * 100) / 100;
}

/** СКИДКА НЕ БОЛЬШЕ ТОГО, С ЧЕГО ОНА СНИМАЕТСЯ. Лист печатает скидку уже
 *  обрезанной по сумме работ, а в черновик уходит вписанное: «200» при работах
 *  на 140 показывалось «−140», сохранялось 200 и потом молча съедало услугу,
 *  добавленную позже. Поэтому на «Применить» поле становится тем, что было
 *  показано. `null` — вписанное и так в пределах, поле не трогаем. */
export function clampedDiscountText(
  value: number,
  percent: boolean,
  linesSum: number,
): string | null {
  const cap = percent ? 100 : Math.max(0, Math.round(linesSum * 100) / 100);
  if (!(value > cap)) return null;
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(2);
}

/** Число денежной ячейки «Итого» — до цента и с обоими знаками: «12.5» в
 *  ячейке рядом с «€12,50» строкой ниже читалось как другая сумма. Целое
 *  остаётся целым — поле не обрастает «,00» на каждой круглой цене. */
export function moneyCellText(value: number): string {
  const cents = Math.round(value * 100) / 100;
  return Number.isInteger(cents) ? String(cents) : cents.toFixed(2);
}
