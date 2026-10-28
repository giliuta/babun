import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ОПЕРАЦИЯ В «ФИНАНСАХ ДНЯ» — ТА ЖЕ ПЛАШКА, ЧТО В ЛЕНТЕ «ФИНАНСОВ». Строки
// тянут react-native и под раннером не поднимаются — проверка по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("строки дня рисует SelectRow, своей геометрии 56pt и суммы 16pt нет", () => {
  const rows = read("rows.tsx");
  assert.match(rows, /import \{ SelectRow \} from "@\/components\/ui\/select-rows";/);
  assert.equal((rows.match(/<SelectRow/g) ?? []).length, 2);
  assert.doesNotMatch(rows, /minHeight: 56/);
  assert.doesNotMatch(rows, /fontSize: 16/);
});

test("список дня — плашки с воздухом, свайп скруглён как плашка", () => {
  assert.match(read("DayList.tsx"), /paddingHorizontal: SELECT_SIDE, gap: 8/);
  assert.match(read("use-day-finance-actions.tsx"), /radius=\{t\.radius\.input\}/);
});
