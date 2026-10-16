import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createScrollSettle, offRow } from "./scroll-settle";
import { ITEM_H } from "./wheel-geometry";

/** Ручные часы: таймер срабатывает, только когда тест сам «ждёт». */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear: (id: unknown) => {
      if (typeof id === "number") timers.delete(id);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

describe("барабан в браузере: выбор по затиханию прокрутки", () => {
  test("лента замолчала — выбор фиксируется по последнему положению", () => {
    const clock = fakeClock();
    const settled: number[] = [];
    const settle = createScrollSettle((y) => settled.push(y), 120, clock.set, clock.clear);
    settle.scroll(10);
    clock.advance(60);
    settle.scroll(80);
    clock.advance(60);
    // Прокрутка ещё идёт: прошло 60 мс с последнего события, а не 120.
    assert.deepEqual(settled, []);
    settle.scroll(ITEM_H * 3);
    clock.advance(120);
    assert.deepEqual(settled, [ITEM_H * 3]);
  });

  test("снятый барабан не фиксирует выбор после ухода", () => {
    const clock = fakeClock();
    const settled: number[] = [];
    const settle = createScrollSettle((y) => settled.push(y), 120, clock.set, clock.clear);
    settle.scroll(40);
    settle.cancel();
    clock.advance(500);
    assert.deepEqual(settled, []);
  });

  test("лента, вставшая между строк, считается недоведённой", () => {
    assert.equal(offRow(ITEM_H * 5), false);
    assert.equal(offRow(ITEM_H * 5 + 0.4), false);
    assert.equal(offRow(ITEM_H * 5 + 13), true);
  });

  test("барабан кормит затихание каждым событием прокрутки и фиксирует по нему", () => {
    // Без этой проводки чистая логика выше есть, а в браузере выбор снова не
    // сохраняется: onMomentumScrollEnd/onScrollEndDrag там не приходят.
    const here = dirname(fileURLToPath(import.meta.url));
    const wheel = readFileSync(resolve(here, "LoopWheelColumn.tsx"), "utf8");
    assert.match(wheel, /onScroll=\{\(e\) => \{[\s\S]{0,200}webSettle\.current\?\.scroll\(y\);/);
    assert.match(wheel, /createScrollSettle\(\(y\) => settleRef\.current\(y, true\)\)/);
  });
});
