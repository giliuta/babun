// Pure money of one «Итого» row.

/** Price of one piece from a typed row sum: the row keeps the unit price and
 *  its total is price × quantity, so a typed sum is divided back. */
export function unitFromRowTotal(total: number, qty: number): number {
  const q = Math.max(1, qty);
  return Math.round((total / q) * 100) / 100;
}
