// Wheel geometry and the pure arithmetic of the looped wheel.

// wheel geometry (= web TimeWheels)
export const ITEM_H = 40;
export const VISIBLE_ROWS = 3;
export const COLUMN_W = 58;
export const DIGIT_FONT = 26;
export const WHEEL_H = ITEM_H * VISIBLE_ROWS;
export const PAD = (WHEEL_H - ITEM_H) / 2;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Шаг минут во ВСЕХ барабанах продукта. Пятиминутка — владелец 2026-08-17:
 *  «минуты должны быть в пятиминутку — 00, 05, 10, 15, 20». */
export const MINUTE_STEP = 5;
export const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  pad2(i * MINUTE_STEP),
);

/** Index of an absolute row inside one cycle of `len` values. */
export const wrapIndex = (i: number, len: number) => ((i % len) + len) % len;

/** Row under the cut line at scroll offset `y`. */
export const rowAt = (y: number) => Math.round(y / ITEM_H);

/** Запас хода, внутри которого лента НЕ переставляется: по целой копии
 *  цикла вверх и вниз от центра (при REPS = 7 это три копии в каждую
 *  сторону — столько одним жестом не проехать). */
export function outsideSafeRange(absolute: number, len: number, reps: number): boolean {
  const SAFE_LO = len;
  const SAFE_HI = (reps - 1) * len;
  return absolute < SAFE_LO || absolute >= SAFE_HI;
}
