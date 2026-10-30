import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// В ЗАПИСИ НЕТ ВИСЯЩИХ ПРЕДУПРЕЖДЕНИЙ О ВРЕМЕНИ (владелец): «Пересекается с
// работой», «Вне графика», «Нерабочий день», «Меньше N мин на дорогу» висели
// жёлтой плашкой под временем. Человек ставит запись, глядя в календарь, и
// всё видит сам; что не так — скажет сервер тостом при сохранении.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), "utf8");

test("плашка времени не рисуется ни в записи, ни в событии", () => {
  for (const body of ["WorkBody.tsx", "EventBody.tsx"]) {
    const src = read(body);
    assert.match(src, /<WhenRow/, `${body}: блок времени на месте`);
    assert.doesNotMatch(src, /warning=\{/, `${body}: без плашки под временем`);
  }
  const when = read("../BookingSummary.tsx");
  const row = when.slice(when.indexOf("export function WhenRow("));
  assert.doesNotMatch(row, /\bwarning\b/);
  assert.doesNotMatch(row, /accessibilityRole="alert"/);
});

test("форма не считает и не объявляет предупреждений о слоте", () => {
  const state = read("use-save-state.ts");
  assert.doesNotMatch(state, /workWarning|timeWarning|overlap/);
  assert.equal(state.match(/announceForAccessibility/g)?.length, 1, "озвучивается только подсказка «Сохранить»");
  assert.equal(existsSync(resolve(here, "use-slot-warnings.ts")), false);
  assert.equal(existsSync(resolve(here, "schedule-warning.ts")), false);
});

test("ни один файл записи не пишет слов прежних плашек", () => {
  const words = [
    "Пересекается с работой",
    "Пересекается с событием",
    "Вне графика",
    "нерабочий день",
    "Вне общих рабочих часов",
    "попадает на перерыв",
    "мин на дорогу",
  ];
  const files = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
  for (const f of files) {
    const src = read(f);
    for (const w of words) assert.ok(!src.includes(`"${w}`) && !src.includes(`\`${w}`), `${f}: «${w}»`);
  }
});
