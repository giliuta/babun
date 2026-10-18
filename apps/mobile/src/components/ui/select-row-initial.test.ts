import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// БУКВА В АВАТАРЕ СТРОКИ ВЫБОРА НЕ РАСТЁТ ЗА КРУЖОК. Плитка фиксированная, а
// буква без потолка шрифта при крупном тексте системы вылезала за неё —
// у соседнего эмодзи потолок 1.2 стоял, у буквы нет.

const here = dirname(fileURLToPath(import.meta.url));

test("буква аватара держит тот же потолок шрифта, что эмодзи", () => {
  const source = readFileSync(resolve(here, "select-rows.tsx"), "utf8");
  assert.match(
    source,
    /<Text maxFontSizeMultiplier=\{1\.2\}[^>]*>\s*\{\(initial \?\? "\?"\)\.slice\(0, 1\)\.toUpperCase\(\)\}/,
  );
});
