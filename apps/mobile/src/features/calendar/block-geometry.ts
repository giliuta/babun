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

/** ЛЕСТНИЦА СОДЕРЖИМОГО БЛОКА: имя → время → услуга → адрес, столько, сколько
 *  влезает по высоте (владелец 2026-09-24: «туда надо больше, чтобы
 *  влазило»). Потолка в три строки больше нет, и услуга с адресом печатаются
 *  и в узкой колонке недели — обрезком по краю, как имя.
 *
 *  В узком блоке (текст уже 96pt) имя из двух слов встаёт в ДВЕ строки —
 *  имя сверху, фамилия под ним, — когда под ними остаётся место хотя бы для
 *  времени. Перенос по словам, а не по буквам: «Конст/антин» читается хуже
 *  обрезка. Порядок только дописывается вниз и не переставляется: при щипке
 *  глаз не теряет якорь. */
export function blockLadder(input: {
  rowsFit: number;
  textW: number;
  nameWords: number;
  hasService: boolean;
  hasAddress: boolean;
}): {
  nameRows: 1 | 2;
  showTime: boolean;
  showService: boolean;
  showAddress: boolean;
  lastRow: "name" | "time" | "service" | "address";
} {
  const rows = Math.max(1, input.rowsFit);
  const nameRows: 1 | 2 =
    input.textW < 96 && input.nameWords > 1 && rows >= 3 ? 2 : 1;
  const left = rows - nameRows;
  const showTime = left >= 1;
  const showService = input.hasService && left >= 2;
  const showAddress = input.hasAddress && left >= (showService ? 3 : 2);
  const lastRow = showAddress
    ? "address"
    : showService
      ? "service"
      : showTime
        ? "time"
        : "name";
  return { nameRows, showTime, showService, showAddress, lastRow };
}

// ── ИМЯ В УЗКОЙ КАРТОЧКЕ ──

/** Нижний предел подгонки кегля имени: 0.85 от 13 = 11, пол шрифта продукта. */
export const NAME_MIN_SCALE = 0.85;
/** Средняя ширина жирной буквы (кириллица и латиница SF) в долях кегля.
 *  Сверено на симуляторе 24.09: «Перерыв» в колонке недели Pro Max (текст
 *  44pt) встаёт целиком при кегле ~11.5, «Константин» — нет. */
const BOLD_GLYPH_EM = 0.55;

/** Можно ли подогнать кегль имени, чтобы оно влезло целиком. iOS сама
 *  предела `minimumFontScale` не держит (Fabric ужимала «Константина» до
 *  нечитаемых 6pt), поэтому решаем здесь: влезает не мельче 11 — сжимаем,
 *  иначе кегль 13 и обрезка по краю, как раньше. */
export function nameShrinkFits(
  text: string,
  textW: number,
  fontSize = 13,
): boolean {
  if (textW <= 0) return false;
  return text.length * fontSize * BOLD_GLYPH_EM * NAME_MIN_SCALE <= textW;
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
