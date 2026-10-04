import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ЛИСТ «ГРАФИК КОМАНДЫ» ПРАВИТ ДЕНЬ ПОВЕРХ СВЕЖЕГО ГРАФИКА (аудит 04.10).
// Апсерт заменяет блоб целиком, а лист собирал его из кэша: упавшее чтение
// (основа — общие часы) или «Выходной», поставленный на другом телефоне,
// стирались первым же поворотом барабана — вместе с перерывами и выходными
// на даты. Теперь хук получает правку функцией и применяет её к графику с
// сервера; общие часы — только когда строки у команды нет.
const sheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "TeamScheduleSheet.tsx"),
  "utf8",
);

test("правка уходит функцией от свежего графика, а не готовым блобом из кэша", () => {
  assert.match(sheet, /schedule: \(current\) => \{\s*const from = current \?\? companyBase;/);
  assert.match(sheet, /return withDay\(from, weekday, patchOf\(dayOf\(from, weekday\)\)\);/);
  assert.doesNotMatch(sheet, /commit\(withDay\(base,/);
});

test("перерыв убирают и правят по значению, а не по номеру", () => {
  assert.match(sheet, /d\.breaks\.filter\(\(b\) => !\(b\.start === victim\.start && b\.end === victim\.end\)\)/);
  assert.match(sheet, /b\.start === was\.start && b\.end === was\.end \? pair : b/);
});
