// МАТЕМАТИКА ЗУМА СЕТКИ — ЧИСТАЯ, ЧТОБЫ ЕЁ ВИДЕЛ ТЕСТ.
//
// Жест живёт на UI-потоке (`zoom.tsx`), а всё, что он считает, — здесь, в
// worklet-функциях без состояния: тест гоняет их тысячами быстрых пинчей и
// сверяет, что время под пальцами не уезжает ни в одном кадре.
//
// Владелец 04.10: «когда растягиваю резко — бегает и подпрыгивает, а если
// быстро — растягивается время и потом резкий скачок»; «именно когда
// увеличиваю». Две причины, обе здесь названы и закрыты:
//
// 1. СКАЧОК НА ОТПУСКАНИИ. Новая высота сетки ложится в layout кадром позже,
//    а прокрутка ставилась сразу — и React Native режет её по СТАРОЙ высоте
//    (`scrollTo` клампит offset по текущему contentSize). При увеличении
//    нужный offset больше старого предела: сетка выросла, а прокрутка
//    осталась у старого края — на симуляторе 13:00 под пальцами превратилось
//    в 06:00. Поэтому отпускание — в два шага (`pinchRelease`): сперва новая
//    высота при том же offset, картинку держит сдвиг; прокрутка — когда
//    выросшая сетка уже на экране.
// 2. РЫВОК НА СТАРТЕ. Пинч признаётся не сразу: пока пальцы разъезжаются до
//    порога, масштаб уже ушёл от единицы, и первый кадр прыгал на эту долю
//    (при быстром жесте — на десятки процентов). Масштаб отсчитывается от
//    момента, когда жест признан (`scale0`).

export const HOUR_H_DEFAULT = 64;
export const HOUR_H_MIN = 28;
export const HOUR_H_MAX = 200;

// Content paddings of the grid scroll — part of the anchor math, so they
// live next to it instead of inline in the views. Bottom is cosmetic
// breathing room only: the create flow is tap-a-slot (no floating button
// to clear), and the zoom floor below guarantees the grid itself always
// fills the viewport — a big trailing pad would just read as a dead void
// under the last hour.
export const PAD_TOP = 6;
export const PAD_BOTTOM = 16;

/** Предел прокрутки сетки: `span` часов по `h` px при вьюпорте `vh`. */
export function maxScroll(span: number, h: number, vh: number): number {
  "worklet";
  return Math.max(0, PAD_TOP + span * h + PAD_BOTTOM - vh);
}

/** Пол зума: всё окно часов обязано заполнять вьюпорт (ceil — без щели в
 *  долю пикселя под последним часом). */
export function minHourH(span: number, vh: number): number {
  "worklet";
  const fit = Math.ceil((vh - PAD_TOP - PAD_BOTTOM) / span);
  return Math.min(HOUR_H_MAX, Math.max(HOUR_H_MIN, fit));
}

/** Время (часы от начала окна) под фокусом пальцев. `visible` — offset,
 *  который человек ВИДИТ: прокрутка минус сдвиг, ещё не перенесённый в неё. */
export function pinchAnchor(visible: number, focalY: number, baseH: number): number {
  "worklet";
  return (visible + focalY - PAD_TOP) / baseH;
}

export type PinchFrameInput = {
  baseH: number;
  anchor: number;
  /** Масштаб жеста в этом кадре и его значение в момент признания. */
  scale: number;
  scale0: number;
  focalY: number;
  span: number;
  vh: number;
};

/** Кадр жеста: высота часа и offset, при котором якорное время стоит под
 *  фокусом (дрейф фокуса = двухпальцевый пан), края — как bounces=false. */
export function pinchFrame(p: PinchFrameInput): { h: number; offset: number } {
  "worklet";
  const rel = p.scale0 > 0 ? p.scale / p.scale0 : p.scale;
  const h = Math.min(
    HOUR_H_MAX,
    Math.max(minHourH(p.span, p.vh), p.baseH * rel),
  );
  const offset = Math.min(
    maxScroll(p.span, h, p.vh),
    Math.max(0, PAD_TOP + p.anchor * h - p.focalY),
  );
  return { h, offset };
}

/** Отпускание: целая высота, конечная прокрутка и сдвиг, который держит
 *  картинку, пока прокрутка стоит на `scrollY0` (шаг 1 из двух).
 *
 *  Держится то, что ВИДНО в последнем кадре (`offset`), а не якорь начала
 *  жеста: у края дня якорь уже не под пальцами (сетка упёрлась), и
 *  перепривязка к нему на отпускании дёргала картинку (тест поймал до 2 px).
 *  Округление высоты до целого пикселя растягивается от фокуса пальцев. */
export function pinchRelease(p: {
  h: number;
  offset: number;
  focalY: number;
  scrollY0: number;
  span: number;
  vh: number;
}): { snapped: number; target: number; holdTy: number } {
  "worklet";
  const snapped = Math.min(
    HOUR_H_MAX,
    Math.max(minHourH(p.span, p.vh), Math.round(p.h)),
  );
  const underFingers = (p.offset + p.focalY - PAD_TOP) / p.h;
  const target = Math.min(
    maxScroll(p.span, snapped, p.vh),
    Math.max(0, PAD_TOP + underFingers * snapped - p.focalY),
  );
  return { snapped, target, holdTy: p.scrollY0 - target };
}

/** Сколько кадров отпускание дожимает прокрутку, прежде чем сдаться (на
 *  симуляторе хватает двух: кадр, где нативный скролл ещё не знает новой
 *  высоты, и следующий). */
export const SETTLE_TRIES = 30;

/** Шаг 2 отпускания, один кадр: прокрутка только что попросила `target`, а
 *  встала на `actual` (RN клампит по contentSize, который нативный скролл
 *  ещё может знать старым). Сдвиг `ty` равен недокрученному остатку —
 *  картинка стоит при любом фактическом offset; `again` — дожать в
 *  следующем кадре.
 *
 *  Готово, когда прокрутка встала ТОЧНО. Порог в полпикселя оставлял у края
 *  дня недокрутку в 0.3 px навсегда (тест поймал); если же offset перестал
 *  меняться в пределах полпикселя (округление нативного скролла), дальше
 *  дожимать нечего. */
export function settleStep(
  actual: number,
  target: number,
  tries: number,
  prevActual: number,
): { ty: number; again: boolean } {
  "worklet";
  const rest = actual - target;
  const exact = Math.abs(rest) <= 0.05;
  const stalled =
    tries > 0 && Math.abs(actual - prevActual) <= 0.05 && Math.abs(rest) <= 0.5;
  const again = !exact && !stalled && tries < SETTLE_TRIES;
  return { ty: again ? rest : 0, again };
}

/** Где на экране (от верха вьюпорта) стоит время `t` часов: сетка с
 *  layout-высотой часа `layoutH`, растянутая жестом в `scale` раз от верха
 *  строки и сдвинутая на `ty`, при прокрутке `scrollY`. Одна формула для
 *  жеста, отпускания и покоя — по ней тест и меряет скачки. */
export function screenY(
  t: number,
  g: { layoutH: number; scale: number; ty: number; scrollY: number },
): number {
  "worklet";
  return PAD_TOP + g.ty + g.scale * t * g.layoutH - g.scrollY;
}
