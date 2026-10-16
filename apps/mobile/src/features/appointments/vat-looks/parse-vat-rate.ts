/** Ставка из набранного: запятая и точка одинаковы, два знака, 0…99.99.
 *  Пусто и неразборчиво — `null`: `Number("")` равно нулю, и очищенное поле
 *  молча записывало бы 0 % в память телефона, откуда его берут запись, инвойс
 *  и чек. Написанный рукой «0» остаётся нулём. */
export function parseVatRate(text: string): number | null {
  const trimmed = text.replace(",", ".").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value >= 100) return null;
  return Math.round(value * 100) / 100;
}
