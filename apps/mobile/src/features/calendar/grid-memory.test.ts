import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  hourHForZoom,
  scrollYForTopHour,
  topHourForScrollY,
  zoomForHourH,
  zoomFromPct,
  zoomPctHint,
  zoomToPct,
} from "./grid-memory";
import { HOUR_H_DEFAULT, HOUR_H_MAX, maxScroll, minHourH, PAD_BOTTOM, PAD_TOP } from "./zoom-math";

// ПАМЯТЬ СЕТКИ: масштаб «сколько часов на экране» и время у
// верхнего края переживают перезапуск, смену вида и команды.

const VH = 519.33;

describe("масштаб — в часах на экране", () => {
  test("«весь день» — сетка ровно заполняет экран при любом окне", () => {
    for (const span of [24, 18, 12, 6]) {
      const h = hourHForZoom("fit", span, VH);
      assert.equal(h, minHourH(span, VH));
      assert.ok(PAD_TOP + span * h + PAD_BOTTOM >= VH);
    }
  });

  test("«8 часов» — на экране восемь часов", () => {
    const h = hourHForZoom(8, 24, VH);
    assert.ok(Math.abs((VH - PAD_TOP - PAD_BOTTOM) / h - 8) < 0.1);
  });

  test("без выбора — прежние 64 px: у тех, кто не настраивал, ничего не меняется", () => {
    assert.equal(hourHForZoom(null, 24, VH), HOUR_H_DEFAULT);
  });

  test("часов больше, чем в окне, — не щель, а весь день", () => {
    assert.equal(hourHForZoom(12, 8, VH), minHourH(8, VH));
    assert.ok(hourHForZoom(0.5, 24, VH) <= HOUR_H_MAX);
  });

  test("щипок туда и обратно: записанный масштаб даёт ту же высоту", () => {
    for (let h = minHourH(24, VH) + 1; h <= HOUR_H_MAX; h++) {
      const zoom = zoomForHourH(h, 24, VH);
      assert.ok(Math.abs(hourHForZoom(zoom, 24, VH) - h) <= 1, `${h} px вернулось иначе`);
    }
    assert.equal(zoomForHourH(minHourH(24, VH), 24, VH), "fit");
  });

  test("ползунок 0…100: 0 — весь день, 100 — самый крупный, туда и обратно", () => {
    assert.equal(zoomFromPct(0, 18, VH), "fit");
    assert.equal(zoomToPct("fit", 18, VH), 0);
    assert.equal(hourHForZoom(zoomFromPct(100, 18, VH), 18, VH), HOUR_H_MAX);
    assert.equal(zoomToPct(zoomFromPct(100, 18, VH), 18, VH), 100);
    for (let pct = 5; pct <= 100; pct += 5) {
      assert.equal(zoomToPct(zoomFromPct(pct, 18, VH), 18, VH), pct, `${pct}% вернулось иначе`);
    }
    assert.equal(zoomPctHint(0, 18, VH), "Весь день на экране");
    assert.match(zoomPctHint(50, 18, VH), /^≈ \d+ ч на экране$/);
  });
});

describe("время у верхнего края — абсолютное", () => {
  test("туда и обратно без потерь", () => {
    const y = scrollYForTopHour(14.5, 6, 24, 64, VH);
    assert.equal(topHourForScrollY(y, 6, 64), 14.5);
  });

  test("переход в команду с другим окном держит то же время", () => {
    const top = topHourForScrollY(scrollYForTopHour(12, 6, 24, 64, VH), 6, 64);
    const y = scrollYForTopHour(top, 8, 22, 64, VH);
    assert.equal(topHourForScrollY(y, 8, 64), 12);
  });

  test("за краями окна — упор, а не пустота", () => {
    assert.equal(scrollYForTopHour(3, 6, 24, 64, VH), 0);
    assert.equal(scrollYForTopHour(23.5, 6, 24, 64, VH), maxScroll(18, 64, VH));
  });
});

describe("сетка открывается на месте", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "zoom.tsx"), "utf8");

  test("первый кадр — из памяти, без прыжка после замера", () => {
    assert.match(src, /const layoutH = useSharedValue\(boot\?\.h \?\? HOUR_H_DEFAULT\);/);
    assert.match(src, /contentOffset=\{boot \? \{ x: 0, y: boot\.y \} : undefined\}/);
    assert.match(src, /if \(boot && !isWeb && Math\.abs\(boot\.vh - vh\) < 0\.5\) return;/);
  });

  test("час графика больше не дёргает прокрутку при свайпе", () => {
    assert.doesNotMatch(src, /\}, \[scrollToHour, startHour\]\);/);
  });

  test("щипок запоминается, место — когда прокрутка встала", () => {
    assert.match(src, /runOnJS\(commitZoom\)\(layoutH\.value\);/);
    assert.match(src, /writeGridZoom\(zoomForHourH\(h, e0 - s0, vh\)\);/);
    assert.match(src, /onMomentumEnd: \(e\) => \{\s*runOnJS\(saveTop\)/);
  });
});

test("лента страниц: замер ширины не монтирует видимую неделю второй раз (11.10)", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "pager.tsx"), "utf8");
  assert.match(src, /const offs = width > 0 \? \(\[-1, 0, 1\] as const\) : \(\[0\] as const\);/);
  assert.match(src, /key=\{idx \+ off\}/);
  // Голой страницы до замера больше нет — у неё был другой ключ.
  assert.doesNotMatch(src, /\) : \(\s*(\/\/[^\n]*\s*)*renderPage\(0\)/);
});
