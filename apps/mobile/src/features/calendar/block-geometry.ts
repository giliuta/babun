// АРИФМЕТИКА БЛОКА И ЧИПА — ОТДЕЛЬНО ОТ ОТРИСОВКИ, ПОТОМУ ЧТО ОНА УЖЕ ВРАЛА
// ДВАЖДЫ.
//
// Первый раз: просроченный блок резервировал место под угловой знак ПОСЛЕ
// того, как решено «имя влезает», и в колонке недели на экране 393pt выходил
// немым — без имени клиента. Второй раз: чип «весь день» отнимал место под
// «+N» тоже после решения, и на 375 и 390pt терял имя. Оба раза дефект был
// невидим в коде — он жил в порядке двух вычитаний.
//
// Здесь ни одного импорта: модуль считает точки и ничего не рисует, поэтому
// его целиком накрывает тест.

/** Обвязка карточки по вертикали: кант сверху и снизу плюс вертикальный
 *  паддинг. Постоянна при любой толщине канта — паддинг компенсирует её
 *  (при bw 1 это 2+4, при bw 2 — 4+2). */
export const CARD_CHROME_H = 6;

/** Порог, ниже которого текст не печатают: обрезок хуже пустоты. */
export const TEXT_MIN_W = 24;

/** Сколько строк ФИЗИЧЕСКИ помещается в карточке высотой `cardH`. */
export function rowsThatFit(cardH: number, lineH: number): number {
  return Math.floor((cardH - CARD_CHROME_H) / lineH);
}

/** Сколько строк печатать: не больше трёх, но и не меньше одной — у самого
 *  низкого блока имя пытается напечататься всегда. */
export function textRows(cardH: number, lineH: number): number {
  return Math.min(3, Math.max(1, rowsThatFit(cardH, lineH)));
}

// ── ЧИПЫ «ВЕСЬ ДЕНЬ» ──

export const CHIP_GAP = 2;
/** Грубая отсечка сверху; настоящее решение принимает `chipsThatFit`. */
export const CHIP_MIN_W = 34;

/** Паддинг чипа. Третья ступень (3pt) — не косметика: колонка недели на
 *  экранах 375 и 390pt даёт чипу со счётчиком ширину текста ниже порога имени
 *  при паддинге 4. */
export const chipPad = (w: number): number =>
  w >= 96 ? 6 : w >= 60 ? 4 : 3;

/** Резерв справа под «+N», ПО РАЗРЯДАМ числа. Фиксированные 14pt врали в обе
 *  стороны: «+11» с крупным системным шрифтом занимает около 23pt и наезжал на
 *  имя, а «+1» отнимал у имени лишние две точки там, где их не хватало. */
export const chipOverflowW = (n: number): number => 8 + 4 * String(n).length;

/** Внутренняя ширина чипа: паддинг с двух сторон, кант с двух сторон, резерв. */
export const chipTextW = (w: number, reserve: number): number =>
  w - 2 * chipPad(w) - 2 - reserve;

/** Сколько чипов показать в полосе шириной `cellW`, если событий `total`.
 *
 *  Чипы делят ширину поровну, но их число ограничено снизу ЧИТАЕМОЙ шириной: в
 *  колонке недели помещается ровно один чип, и пять отпусков пяти мастеров
 *  дают один чип с именем и счётчиком «+4», а не пять безымянных плашек по 7pt.
 *  Резерв под «+N» входит в решение, а не отнимается после него. */
export function chipsThatFit(cellW: number, total: number): number {
  if (total <= 0 || cellW <= 0) return 0;
  const fits = (count: number): boolean => {
    if (count < 1) return false;
    const w = (cellW - CHIP_GAP * (count - 1)) / count;
    if (w < CHIP_MIN_W) return false;
    const rest = total - count;
    return chipTextW(w, rest > 0 ? chipOverflowW(rest) : 0) >= TEXT_MIN_W;
  };
  const roomy = Math.max(
    1,
    Math.floor((cellW + CHIP_GAP) / (CHIP_MIN_W + CHIP_GAP)),
  );
  let shown = Math.min(total, roomy);
  while (shown > 1 && !fits(shown)) shown -= 1;
  return shown;
}
