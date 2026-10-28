import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "font-scale-reload.ts"), "utf8");

test("смена шрифта на ходу на Android — новый запуск кода, а не старые замеры", () => {
  // Хуки тянут react-native и под раннером не поднимаются — проверка по исходнику.
  assert.match(source, /if \(Platform\.OS !== "android"\) return \(\) => \{\};/);
  assert.match(source, /if \(fontScaleMoved\(atStart, window\.fontScale\)\) reloadApp\(\);/);
  assert.match(source, /return Math\.abs\(now - before\) >= 0\.01;/);
  const layout = readFileSync(resolve(here, "../../app/_layout.tsx"), "utf8");
  assert.match(layout, /useEffect\(\(\) => watchFontScaleReload\(\), \[\]\);/);
});
