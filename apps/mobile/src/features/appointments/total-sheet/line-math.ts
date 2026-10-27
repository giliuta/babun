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
