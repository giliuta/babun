import type { TourShape } from "./tour-store";

// ГЕОМЕТРИЯ ПОДСКАЗКИ — без React и без экрана: где вырез, где пузырь, куда
// смотрит стрелка пузыря. Отдельно, чтобы правила были проверяемы тестами.

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** Зазор между вырезом и пузырём. */
export const GAP = 12;
/** Отступ выреза вокруг кнопки или плитки. */
export const CONTROL_PAD = 6;
/** Поле между вырезом и краем экрана. */
export const EDGE = 4;
/** Поля пузыря от краёв экрана. */
export const BUBBLE_SIDE = 16;
/** Стрелка не ближе этого к скруглённому углу пузыря. */
const CARET_INSET = 22;

/** Вырез внутри экрана с полем `EDGE`: на краю он сжимается поровну с обеих
 *  сторон, а не режется, — цель остаётся посередине. */
export function clampToScreen(r: Rect, size: Size): Rect {
  if (size.w === 0) return r;
  const over = Math.max(0, EDGE - r.x, r.x + r.w - (size.w - EDGE));
  return { x: r.x + over, y: r.y, w: Math.max(0, r.w - over * 2), h: r.h };
}

/** ВЫРЕЗ ПО ФОРМЕ ЦЕЛИ. Строка карточки — ровно по карточке с её
 *  скруглением; кнопка и плитка — с ровным отступом со всех сторон (рамка по
 *  самому нажимаемому полю ложилась криво: у него свои несимметричные поля);
 *  полоса во всю ширину — во всю ширину и без скругления. */
export function spotFor(
  target: Rect,
  shape: TourShape,
  size: Size,
  cardRadius: number,
): { spot: Rect; radius: number } {
  const pad = shape === "control" ? CONTROL_PAD : 0;
  const raw = { x: target.x - pad, y: target.y - pad, w: target.w + pad * 2, h: target.h + pad * 2 };
  return {
    spot: shape === "strip" ? raw : clampToScreen(raw, size),
    radius: shape === "strip" ? 0 : cardRadius + pad,
  };
}

export type BubbleSide = "below" | "above" | "over";

/** Где встаёт пузырь: под вырезом, над ним, а если цель во весь экран — у
 *  нижнего края поверх неё. `keep` — то, что шаг просит не закрывать
 *  (строку с только что выбранным именем и цветом). Клавиатура срезает низ. */
export function placeBubble(
  spot: Rect,
  keep: Rect | null,
  bubbleH: number,
  size: Size,
  keyboardH: number,
): { top: number; side: BubbleSide } {
  const top = keep ? Math.min(spot.y, keep.y) : spot.y;
  const bottomEdge = keep ? Math.max(spot.y + spot.h, keep.y + keep.h) : spot.y + spot.h;
  const bottom = size.h - keyboardH;
  const below = bottomEdge + GAP;
  if (below + bubbleH <= bottom - GAP) return { top: below, side: "below" };
  const above = top - GAP - bubbleH;
  if (above >= GAP) return { top: above, side: "above" };
  return { top: bottom - bubbleH - 24, side: "over" };
}

/** Стрелка пузыря смотрит на середину выреза: отступ от левого края пузыря,
 *  не ближе `CARET_INSET` к его скруглённым углам. */
export function caretOffset(spot: Rect, size: Size): number {
  const width = size.w - BUBBLE_SIDE * 2;
  const center = spot.x + spot.w / 2 - BUBBLE_SIDE;
  return Math.min(Math.max(center, CARET_INSET), Math.max(CARET_INSET, width - CARET_INSET));
}
