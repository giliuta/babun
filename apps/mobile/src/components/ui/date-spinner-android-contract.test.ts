import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ДАТА НА ANDROID — БАРАБАНЫ В ШТОРКЕ, А НЕ СИСТЕМНЫЙ ДИАЛОГ (13.10). Системный
// «спиннер» Android — диалог, который открывался по кругу на каждой
// перерисовке и считал «Отмену» выбором. Проверено на эмуляторе Android 16.
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

test("у DateSpinner есть Android-двойник без системного пикера", () => {
  const android = read("DateSpinner.android.tsx");
  assert.doesNotMatch(android, /DateTimeInput|datetimepicker/);
  assert.match(android, /<LoopWheelColumn/);
  // Диапазон лет — один на открытие: перестроенный вокруг текущего года, он
  // сдвигал ленту во время довода, и сохранялся не тот год, что под линией.
  assert.match(android, /const \[openYear\] = useState\(year\);/);
});

test("колёса крутятся внутри прокручиваемой шторки на Android", () => {
  assert.match(read("TimeWheel.tsx"), /<ScrollView\s+ref=\{ref\}\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+nestedScrollEnabled/);
  assert.match(read("DateSpinner.android.tsx"), /nestedScrollEnabled/);
});

test("кольцо переставляет ленту и при смене длины цикла (день: 31 → 28)", () => {
  assert.match(read("TimeWheel.tsx"), /if \(settledRef\.current === value && settledMid\.current === mid\) return;/);
});

test("период «Финансов» и дата перевода — через DateSpinner, а не сырой пикер", () => {
  for (const f of ["../../features/finances/PeriodSheets.tsx", "../../features/finances/TransferSheet.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /<DateTimeInput/, f);
    assert.match(src, /<DateSpinner/, f);
  }
});
