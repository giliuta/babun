/** Ставка из набранного: запятая и точка одинаковы, два знака, 0…99.99.
 *  Пусто и неразборчиво — `null`: `Number("")` равно нулю, и очищенное поле
 *  молча записывало бы 0 % в память телефона, откуда его берут запись, инвойс
 *  и чек. Написанный рукой «0» остаётся нулём. */
export function parseVatRate(text: string): number | null {
  const trimmed = text.replace(",", ".").trim();
  if (trimmed === "") return null;
  // Только десятичная запись: `Number` понимал «0x10» и «1e1» из вставки.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  // Предел — после округления: «99.999» округлялось до 100, которые память
  // не принимает, и поле показывало одну ставку, а считало другой.
  const value = Math.round(Number(trimmed) * 100) / 100;
  if (!Number.isFinite(value) || value >= 100) return null;
  return value;
}
