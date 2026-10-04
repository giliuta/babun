import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HOUR_H_MAX,
  maxScroll,
  minHourH,
  PAD_BOTTOM,
  PAD_TOP,
  pinchAnchor,
  pinchFrame,
  pinchRelease,
  screenY,
  settleStep,
} from "./zoom-math";

// ЗУМ СЕТКИ: ТЫСЯЧИ БЫСТРЫХ ПИНЧЕЙ НА МОДЕЛИ КАДРА (04.10).
//
// Владелец: «когда растягиваю резко — бегает и подпрыгивает; если быстро —
// растягивается время и потом резкий скачок»; «именно когда увеличиваю».
// На симуляторе: 13:00 под пальцами после сильного увеличения превращалось в
// 06:00 — React Native клампил прокрутку по старой высоте сетки.
//
// Модель кадра повторяет порядок, пойманный на устройстве:
//   1) события жеста и колбэки requestAnimationFrame пишут shared values;
//   2) коммит кадра выносит их на экран — высота, сдвиг и масштаб вместе;
//   3) `scrollTo` срабатывает сразу, но клампится по высоте, которая на
//      экране СЕЙЧАС (последний коммит), а не по только что записанной.

const VH = 519.33; // вьюпорт сетки недели на iPhone 17 Pro (замерен)

type Mounted = { layoutH: number; scale: number; ty: number };

class Grid {
  mounted: Mounted;
  pending: Partial<Mounted> = {};
  raf: (() => void)[] = [];
  constructor(
    public span: number,
    h: number,
    public scrollY: number,
  ) {
    this.mounted = { layoutH: h, scale: 1, ty: 0 };
  }
  /** Чтение shared value — последнее записанное, даже если не на экране. */
  read<K extends keyof Mounted>(k: K): number {
    return this.pending[k] ?? this.mounted[k];
  }
  write(p: Partial<Mounted>) {
    Object.assign(this.pending, p);
  }
  scrollTo(y: number) {
    const max = maxScroll(this.span, this.mounted.layoutH, VH);
    this.scrollY = Math.min(max, Math.max(0, y));
  }
  frame() {
    const callbacks = this.raf;
    this.raf = [];
    for (const cb of callbacks) cb();
    Object.assign(this.mounted, this.pending);
    this.pending = {};
  }
  y(t: number): number {
    return screenY(t, { ...this.mounted, scrollY: this.scrollY });
  }
}

type Frame = { scale: number; focalY: number };
type Pinch = { scale0: number; focal0: number; frames: Frame[] };

/** Время, видимое на экране сейчас (с запасом за края — для проб). */
function probes(g: Grid): number[] {
  const out: number[] = [];
  for (let t = 0; t <= g.span; t += 0.25) {
    const y = g.y(t);
    if (y >= -40 && y <= VH + 40) out.push(t);
  }
  return out;
}

/** Ровно то, что делает `zoom.tsx`: onStart, кадры onUpdate, onFinalize и
 *  шаги отпускания через requestAnimationFrame. Возвращает след кадров. */
function runPinch(g: Grid, p: Pinch) {
  const baseH = g.read("layoutH");
  const scrollY0 = g.scrollY;
  const anchor = pinchAnchor(g.scrollY - g.read("ty"), p.focal0, baseH);
  const before = new Map(probes(g).map((t) => [t, g.y(t)]));
  const gesture: { focalY: number; offset: number; h: number; ys: Map<number, number> }[] = [];
  let h = baseH;
  let lastFocal = p.focal0;
  let lastOffset = scrollY0 - g.read("ty");
  for (const fr of p.frames) {
    const f = pinchFrame({
      baseH,
      anchor,
      scale: fr.scale,
      scale0: p.scale0,
      focalY: fr.focalY,
      span: g.span,
      vh: VH,
    });
    h = f.h;
    lastFocal = fr.focalY;
    lastOffset = f.offset;
    g.write({ scale: f.h / baseH, ty: scrollY0 - f.offset });
    g.frame();
    gesture.push({
      focalY: fr.focalY,
      offset: f.offset,
      h: f.h,
      ys: new Map(probes(g).map((t) => [t, g.y(t)])),
    });
  }
  const last = gesture[gesture.length - 1];
  const r = pinchRelease({
    h,
    offset: lastOffset,
    focalY: lastFocal,
    scrollY0,
    span: g.span,
    vh: VH,
  });
  g.write({ layoutH: r.snapped, scale: 1, ty: r.holdTy });
  let settled = false;
  const step = (tries: number, prev: number) => {
    g.scrollTo(r.target);
    const actual = g.scrollY;
    const s = settleStep(actual, r.target, tries, prev);
    g.write({ ty: s.ty });
    if (s.again) g.raf.push(() => step(tries + 1, actual));
    else settled = true;
  };
  g.raf.push(() => step(0, g.scrollY));
  const release: Map<number, number>[] = [];
  let frames = 0;
  while (!settled && frames < 60) {
    g.frame();
    frames++;
    release.push(new Map([...last.ys.keys()].map((t) => [t, g.y(t)])));
  }
  // Время под пальцами в последнем кадре — точка, от которой растягивается
  // округление высоты (у края дня это уже не якорь начала жеста).
  const pivot = (lastOffset + lastFocal - PAD_TOP) / h;
  return { anchor, pivot, before, gesture, last, release, r, h, frames, settled };
}

// Детерминированный генератор: каждый прогон — те же тысячи жестов.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPinch(rand: () => number, zoomIn: boolean): { g: Grid; p: Pinch } {
  const span = [24, 15, 10][Math.floor(rand() * 3)];
  const lo = minHourH(span, VH);
  const h0 = Math.round(lo + rand() * (HOUR_H_MAX - lo));
  const g = new Grid(span, h0, rand() * maxScroll(span, h0, VH));
  const focal0 = 20 + rand() * (VH - 40);
  // Быстрый жест: 2–6 кадров до итогового масштаба, пальцы плывут.
  const n = 2 + Math.floor(rand() * 5);
  const end = zoomIn ? 1 + rand() * 3.5 : 1 / (1 + rand() * 3.5);
  const scale0 = 0.8 + rand() * 0.6;
  const frames: Frame[] = [];
  let focal = focal0;
  for (let i = 1; i <= n; i++) {
    focal = Math.min(VH - 5, Math.max(5, focal + (rand() - 0.5) * 60));
    frames.push({ scale: scale0 * (1 + (end - 1) * (i / n)), focalY: focal });
  }
  return { g, p: { scale0, focal0, frames } };
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

describe("зум сетки: время под пальцами", () => {
  test("первый кадр не прыгает: масштаб — от признания жеста", () => {
    // Жест признан, когда пальцы уже разъехались на треть: прежде первый
    // кадр отскакивал на эти 33 % (на симуляторе — scale 1.333 в onStart).
    const g = new Grid(24, 64, 576);
    const run = runPinch(g, {
      scale0: 1.333,
      focal0: 262,
      frames: [{ scale: 1.333, focalY: 262 }],
    });
    for (const [t, y] of run.before) {
      assert.ok(near(run.gesture[0].ys.get(t) ?? NaN, y, 0.01), `${t} ч сдвинулось в первом кадре`);
    }
  });

  test("случай с симулятора: 13:00 остаётся под пальцами после сильного увеличения", () => {
    // До правки: прокрутка резалась по старой высоте — 2344 → 1038.67,
    // и под пальцами оказывалось 06:00.
    const g = new Grid(24, 64, 576);
    const frames: Frame[] = [];
    for (let i = 1; i <= 12; i++) frames.push({ scale: 1.333 * (1 + 3 * (i / 12)), focalY: 262 });
    const run = runPinch(g, { scale0: 1.333, focal0: 262, frames });
    assert.equal(run.anchor, 13);
    assert.equal(run.r.snapped, HOUR_H_MAX);
    assert.ok(near(g.y(13), 262, 0.01), `под пальцами ${((g.scrollY + 262 - PAD_TOP) / g.mounted.layoutH).toFixed(2)} ч`);
    assert.equal(g.mounted.ty, 0);
    assert.equal(g.scrollY, run.r.target);
    assert.ok(run.frames <= 3, `прокрутка встала за ${run.frames} кадров`);
  });

  for (const zoomIn of [true, false]) {
    test(`${zoomIn ? "увеличение" : "уменьшение"}: 3000 быстрых жестов без рывка ни в одном кадре`, () => {
      const rand = rng(zoomIn ? 404 : 405);
      for (let i = 0; i < 3000; i++) {
        const { g, p } = randomPinch(rand, zoomIn);
        const run = runPinch(g, p);
        // Каждый кадр жеста: якорное время — под фокусом; у края — край на месте.
        for (const fr of run.gesture) {
          const max = maxScroll(g.span, fr.h, VH);
          const yAnchor = fr.ys.get(run.anchor) ?? screenY(run.anchor, { ...g.mounted, scrollY: g.scrollY });
          if (fr.offset > 0 && fr.offset < max) {
            assert.ok(near(yAnchor, fr.focalY, 0.01) || !fr.ys.has(run.anchor), `жест ${i}: якорь ушёл из-под пальцев`);
          }
        }
        // Отпускание: картинка не двигается ни в одном кадре — только
        // округление высоты до целого пикселя, ноль под пальцами.
        assert.ok(run.settled, `жест ${i}: прокрутка не встала`);
        assert.ok(run.frames <= 3, `жест ${i}: встала за ${run.frames} кадров`);
        for (const ys of run.release) {
          for (const [t, y0] of run.last.ys) {
            const tol = Math.abs(run.r.snapped - run.h) * Math.abs(t - run.pivot) + 0.02;
            const edge = run.r.target === 0 || run.r.target === maxScroll(g.span, run.r.snapped, VH);
            const y = ys.get(t) as number;
            assert.ok(
              near(y, y0, tol) || (edge && near(y, y0, Math.abs(run.r.snapped - run.h) * g.span + 0.02)),
              `жест ${i}: ${t} ч прыгнуло на ${(y - y0).toFixed(2)} px при отпускании`,
            );
          }
        }
        // В покое: сдвига нет, прокрутка — та, что просили, высота — целая.
        assert.equal(g.mounted.ty, 0);
        assert.equal(g.mounted.scale, 1);
        assert.equal(g.scrollY, run.r.target);
        assert.ok(Number.isInteger(g.mounted.layoutH));
        // И сетка заполняет экран: ни щели под последним часом, ни выхода за края.
        assert.ok(g.y(0) <= PAD_TOP + 0.01 && g.y(g.span) >= VH - PAD_BOTTOM - 0.01);
      }
    });
  }

  test("новый жест посреди отпускания стартует с того, что видно", () => {
    const g = new Grid(24, 64, 576);
    const frames: Frame[] = [1.5, 2, 3].map((s) => ({ scale: s, focalY: 262 }));
    const first = runPinch(g, { scale0: 1, focal0: 262, frames });
    assert.ok(first.settled);
    // Отпускание первого жеста оборвано на шаге 1: сдвиг ещё держит картинку.
    const r = pinchRelease({ h: 120.4, offset: 6 + 13 * 120.4 - 262, focalY: 262, scrollY0: g.scrollY, span: 24, vh: VH });
    g.write({ layoutH: r.snapped, scale: 1, ty: r.holdTy });
    g.frame();
    const seen = new Map(probes(g).map((t) => [t, g.y(t)]));
    const second = runPinch(g, { scale0: 1, focal0: 300, frames: [{ scale: 1, focalY: 300 }] });
    for (const [t, y] of seen) {
      assert.ok(near(second.gesture[0].ys.get(t) ?? y, y, 0.01), `${t} ч сдвинулось на старте второго жеста`);
    }
  });
});

describe("зум сетки: устройство компонента", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "zoom.tsx"), "utf8");
  const between = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

  test("на отпускании прокрутка не трогается — только шагом 2", () => {
    const finalize = between(".onFinalize(", "const rowStyle");
    assert.doesNotMatch(finalize, /scrollTo\(/);
    assert.match(finalize, /gestureTy\.value = r\.holdTy;/);
    assert.match(finalize, /requestAnimationFrame\(\(\) => settle\(token, r\.target\)\);/);
  });

  test("шаг 2 — локальная функция, а не worklet, зовущий сам себя", () => {
    // Самоссылка `settle` из замыкания роняла приложение на первом же повторе.
    const settle = between("const settle = (", "const pinch = Gesture.Pinch()");
    assert.doesNotMatch(settle.slice(settle.indexOf("{")), /\bsettle\(/);
    assert.match(settle, /const step = \(tries: number, prev: number\) => \{/);
    assert.match(settle, /requestAnimationFrame\(\(\) => step\(tries \+ 1, actual\)\);/);
    assert.match(settle, /const s = settleStep\(actual, target, tries, prev\);/);
  });

  test("масштаб считается от признания жеста", () => {
    assert.match(src, /scale0\.value = e\.scale > 0 \? e\.scale : 1;/);
    assert.match(src, /scale0: scale0\.value,/);
  });
});
