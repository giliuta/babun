// Расчёт места чипа при перетаскивании ленты — лист без React, его читают
// `chip-drag.tsx` и тест.

export const CHIP_GAP = 4;

/** Куда встанет чип с индексом `active`, если его центр сейчас в `center`. */
export function dropIndex(
  boxes: readonly { x: number; w: number }[],
  active: number,
  center: number,
): number {
  "worklet";
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (i === active) continue;
    if (boxes[i].x + boxes[i].w / 2 < center) n++;
  }
  return n;
}

/** Левый край чипа на месте `index` при порядке `order` и ширинах `widths`
 *  (лента начинается с `pad`, между чипами — `CHIP_GAP`). */
export function slotX(
  order: readonly string[],
  widths: Readonly<Record<string, number>>,
  index: number,
  pad: number,
): number {
  "worklet";
  let x = pad;
  for (let i = 0; i < index && i < order.length; i++) x += (widths[order[i]] ?? 0) + CHIP_GAP;
  return x;
}
