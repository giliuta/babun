import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("заставка: тот же знак, что у системной, слово Babun, уходит по готовности календаря (11.10)", () => {
  const splash = read("BootSplash.tsx");
  assert.match(splash, /require\("\.\.\/\.\.\/\.\.\/assets\/splash-icon\.png"\)/);
  assert.match(splash, />\s*Babun\s*</);
  assert.match(splash, /const MAX_MS = 6000;/);
  assert.match(read("../../../app/_layout.tsx"), /<BootSplash hold=\{!!session\} \/>/);
  assert.match(read("../../../app/(dashboard)/(home)/index.tsx"), /if \(!calendarLoading\) markBootReady\(\);/);
});

test("скрытый календарь не мелькает при входе: список скрытых — с телефона, сетка ждёт его (11.10)", () => {
  const hidden = read("../settings/use-hidden-calendars.ts");
  assert.match(hidden, /placeholderData: \(\) => readCache\(userId\)/);
  assert.match(hidden, /writeCache\(userId, keys\);/);
  assert.match(read("../../lib/tenant-prefs.ts"), /"babun:calendars\.hidden:"/);
  const home = read("../../../app/(dashboard)/(home)/index.tsx");
  assert.match(home, /const calendarLoading =\s*(\/\/[^\n]*\s*)*!calendarVisibility\.known \|\|/);
});

test("масштаб — ползунком 0…100 в шторке «Часы календаря» (11.10)", () => {
  const sheet = read("../calendar/HourRangeSheet.tsx");
  assert.match(sheet, /<StepSlider\s+value=\{pct\}\s+min=\{0\}\s+max=\{100\}/);
  assert.match(sheet, /zoom\?\.onApply\(zoomFromPct\(pct, span, zoom\.vh\)\);/);
  const gear = read("../../../app/(dashboard)/(home)/calendar/index.tsx");
  assert.match(gear, /zoom=\{\{ initial: gridZoom, vh: readViewportH\("week"\), onApply: applyZoom \}\}/);
  assert.doesNotMatch(gear, /chooseOption\(/);
});

test("ползунок — на ответчиках RN, не на жесте RNGH: в листе (Modal) жест молчал (11.10)", () => {
  const slider = read("../../components/ui/StepSlider.tsx");
  assert.match(slider, /onResponderMove=\{\(e\) => move\(e\.nativeEvent\.locationX\)\}/);
  assert.doesNotMatch(slider, /GestureDetector/);
});
