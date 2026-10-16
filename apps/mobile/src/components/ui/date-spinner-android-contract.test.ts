import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readModuleSource } from "@/lib/module-source";

// ДАТА НА ANDROID — БАРАБАНЫ В ШТОРКЕ, А НЕ СИСТЕМНЫЙ ДИАЛОГ. Системный
// «спиннер» Android — диалог, который открывался по кругу на каждой
// перерисовке и считал «Отмену» выбором. Проверено на эмуляторе Android 16.
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
// Барабан — вход `TimeWheel.tsx` + колонка в `time-wheel/`.
const wheel = () => readModuleSource(join(__dirname, "TimeWheel.tsx"), join(__dirname, "time-wheel"));
// Лист перевода — вход + шаги в `transfer-sheet/`.
const withParts = (f: string) =>
  f.endsWith("TransferSheet.tsx")
    ? readModuleSource(join(__dirname, f), join(__dirname, "../../features/finances/transfer-sheet"))
    : read(f);

test("у DateSpinner есть Android-двойник без системного пикера", () => {
  const android = read("DateSpinner.android.tsx");
  assert.doesNotMatch(android, /DateTimeInput|datetimepicker/);
  assert.match(android, /<LoopWheelColumn/);
  // Диапазон лет — один на открытие: перестроенный вокруг текущего года, он
  // сдвигал ленту во время довода, и сохранялся не тот год, что под линией.
  assert.match(android, /const \[openYear\] = useState\(year\);/);
});

test("колёса крутятся внутри прокручиваемой шторки на Android", () => {
  assert.match(wheel(), /<ScrollView\s+ref=\{ref\}\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+nestedScrollEnabled/);
  assert.match(read("DateSpinner.android.tsx"), /nestedScrollEnabled/);
});

test("кольцо переставляет ленту и при смене длины цикла (день: 31 → 28)", () => {
  assert.match(wheel(), /if \(settledRef\.current === value && settledMid\.current === mid\) return;/);
});

test("период «Финансов» и дата перевода — через DateSpinner, а не сырой пикер", () => {
  for (const f of ["../../features/finances/PeriodSheets.tsx", "../../features/finances/TransferSheet.tsx"]) {
    const src = withParts(f);
    assert.doesNotMatch(src, /<DateTimeInput/, f);
    assert.match(src, /<DateSpinner/, f);
  }
});
