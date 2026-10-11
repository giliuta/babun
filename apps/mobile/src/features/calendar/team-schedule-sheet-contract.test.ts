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
  // 11.10: правка может касаться нескольких дней сразу (общее время), и
  // каждый день ложится на график с сервера, а не на кэш.
  assert.match(sheet, /schedule: \(current\) =>\s*weekdays\.reduce\(/);
  assert.match(sheet, /\(from, weekday\) => withDay\(from, weekday, patchOf\(dayOf\(from, weekday\)\)\),\s*current \?\? companyBase,/);
  assert.doesNotMatch(sheet, /commit\(withDay\(base,/);
});

// ОБЩЕЕ ВРЕМЯ ПО УМОЛЧАНИЮ, ДНИ — ПО КНОПКЕ; ПЕРЕРЫВОВ НЕТ (владелец 11.10).
test("общий вид пишет часы всем дням, по дням — одному; перерывов в листе нет", () => {
  assert.match(sheet, /if \(mode === "common"\) commitDays\(ALL_DAYS, \(\) => pair\);\s*else commitDay\(\(\) => pair\);/);
  assert.match(sheet, /setMode\(sameHoursEveryDay\(schedule \?\? null\) \? "common" : "days"\);/);
  assert.match(sheet, /label: "По дням"/);
  assert.doesNotMatch(sheet, /＋ Перерыв|label="Перерыв после записи"/);
});
