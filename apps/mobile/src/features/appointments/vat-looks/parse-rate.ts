/** Ставка из набранного: запятая и точка одинаковы, два знака, 0…99.99.
 *  Стёртое поле — `null`, а не ноль: `Number("")` даёт 0, и пустая строка
 *  посреди набора применялась бы и запоминалась как «0 %». */
export function parseVatRate(text: string): number | null {
  const trimmed = text.replace(",", ".").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value >= 100) return null;
  return Math.round(value * 100) / 100;
}
