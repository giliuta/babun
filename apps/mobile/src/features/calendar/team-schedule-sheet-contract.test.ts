import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";

// ЛИСТ «ГРАФИК КОМАНДЫ» ПРАВИТ ДЕНЬ ПОВЕРХ СВЕЖЕГО ГРАФИКА (аудит 04.10).
// Апсерт заменяет блоб целиком, а лист собирал его из кэша: упавшее чтение
// (основа — общие часы) или «Выходной», поставленный на другом телефоне,
// стирались первым же поворотом барабана — вместе с перерывами и выходными
// на даты. Теперь хук получает правку функцией и применяет её к графику с
// сервера; общие часы — только когда строки у команды нет.
// The sheet is `TeamScheduleSheet.tsx` plus its parts in `team-schedule/`.
const here = dirname(fileURLToPath(import.meta.url));
const sheet = readModuleSource(resolve(here, "TeamScheduleSheet.tsx"), resolve(here, "team-schedule"));

test("правка уходит функцией от свежего графика, а не готовым блобом из кэша", () => {
  // 11.10: правка может касаться нескольких дней сразу (общее время), и
  // каждый день ложится на график с сервера, а не на кэш.
  assert.match(sheet, /schedule: \(current\) =>\s*weekdays\.reduce\(/);
  assert.match(sheet, /\(from, weekday\) => withDay\(from, weekday, patchOf\(dayOf\(from, weekday\)\)\),\s*current \?\? companyBase,/);
  assert.doesNotMatch(sheet, /commit\(withDay\(base,/);
});

// ОДИН ЭКРАН (владелец 12.10): дни кнопками, общие часы, тумблер «Разные
// часы по дням»; выключение тумблера пишет всем дням одни часы. Перерывов нет.
test("общие часы — всем дням, дня — ему; выключение «разных» пишет всем одни часы", () => {
  assert.match(sheet, /if \(target === "common"\) commitDays\(ALL_DAYS, \(\) => pair\);\s*else commitDays\(\[target\], \(\) => pair\);/);
  assert.match(sheet, /setPerDay\(!sameHoursEveryDay\(schedule \?\? null\)\);/);
  assert.match(sheet, /label="Разные часы по дням"/);
  assert.match(sheet, /setPerDay\(false\);\s*commitDays\(ALL_DAYS, \(\) => common\);/);
  assert.doesNotMatch(sheet, /label: "По дням"|label: "Для всех дней"/, "вернулись два режима");
  assert.doesNotMatch(sheet, /＋ Перерыв|label="Перерыв после записи"/);
});
