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
const CARD_CHROME_H = 6;

/** Порог, ниже которого текст не печатают: обрезок хуже пустоты. */
export const TEXT_MIN_W = 24;

/** Сколько строк ФИЗИЧЕСКИ помещается в карточке высотой `cardH`. */
export function rowsThatFit(cardH: number, lineH: number): number {
  return Math.floor((cardH - CARD_CHROME_H) / lineH);
}

/** ЛЕСТНИЦА СОДЕРЖИМОГО БЛОКА: имя → время → услуга, столько, сколько
 *  влезает по высоте. Значков внизу нет: оплату, долг и отмену говорит цвет
 *  всего блока (`record-color`) — он виден и у самой короткой записи, а
 *  строка значков у неё пропадала первой.
 *
 *  Имени, времени и услуги хватает, чтобы узнать визит, — адреса на блоке
 *  нет. Имя — ВСЕГДА ОДНОЙ СТРОКОЙ и одним кеглем. Прежде в узком блоке имя из двух слов
 *  вставало в две строки, а короткое ужималось до 11pt — соседние блоки
 *  недели писали имена разным кеглем. Теперь длинное имя тает у края
 *  (`AppointmentBlock`, плёнка в цвет блока), кегль 13 у всех.
 *
 *  Порядок только дописывается вниз и не переставляется: при щипке глаз не
 *  теряет якорь. */
export function blockLadder(input: {
  rowsFit: number;
  hasService: boolean;
}): {
  showTime: boolean;
  showService: boolean;
  lastRow: "name" | "time" | "service";
} {
  const left = Math.max(1, input.rowsFit) - 1;
  const showTime = left >= 1;
  const showService = input.hasService && left >= 2;
  const lastRow = showService ? "service" : showTime ? "time" : "name";
  return { showTime, showService, lastRow };
}

// ── ЧИПЫ «ВЕСЬ ДЕНЬ» ──

export const CHIP_GAP = 2;
/** Грубая отсечка сверху; настоящее решение принимает `chipsThatFit`. */
const CHIP_MIN_W = 34;

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

// ── ТАЮЩИЙ ХВОСТ: КАКАЯ СТРОКА НЕ ВЛЕЗАЕТ ──

/** Средняя ширина знака в долях кегля: цифры табличные, двоеточие и пробел
 *  узкие, жирные буквы шире обычных. Оценка с запасом в пользу «влезает»:
 *  ложная плёнка гасит край короткого времени («10:00»), а пропущенная лишь
 *  оставляет обрезок буквы. */
function glyphEm(ch: string, bold: boolean): number {
  if (ch >= "0" && ch <= "9") return 0.6;
  if (ch === ":" || ch === " " || ch === "." || ch === "," || ch === "–") return 0.3;
  return bold ? 0.6 : 0.54;
}

/** Не влезает ли строка в ширину — тогда её край тает под плёнкой. */
export function textOverflows(
  text: string,
  width: number,
  opts: { fontSize?: number; bold?: boolean } = {},
): boolean {
  if (width <= 0) return false;
  const size = opts.fontSize ?? 13;
  let em = 0;
  for (const ch of text) em += glyphEm(ch, opts.bold ?? false);
  return em * size > width;
}
