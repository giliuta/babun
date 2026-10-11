// Расчёт места чипа при перетаскивании ленты — лист без React, его читают
// `chip-drag.tsx` и тест.

export const CHIP_GAP = 8;

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

/** Сдвиг соседа `index`, пока `active` тянут к месту `target`. */
export function shiftOf(index: number, active: number, target: number, width: number): number {
  "worklet";
  if (active < 0 || index === active) return 0;
  if (active < index && index <= target) return -(width + CHIP_GAP);
  if (active > index && index >= target) return width + CHIP_GAP;
  return 0;
}
