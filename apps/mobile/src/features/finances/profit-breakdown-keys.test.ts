import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «РАЗБОР ПРИБЫЛИ»: КАТЕГОРИЯ «МАТЕРИАЛЫ» И МАТЕРИАЛЫ ЗАПИСЕЙ — РАЗНЫЕ СТРОКИ.
// Сравнение с прошлым периодом раньше шло по имени и
// складывало обе в одну цифру: «↑25%» вместо +50 % и «↓79%» вместо +25 %.
// Экран тянет react-native — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(resolve(here, "ProfitBreakdown.tsx"), "utf8");

test("прошлый период сравнивается по id строки, а не по имени", () => {
  assert.match(screen, /before\?\.\[kind\]\.get\(r\.id\)/);
  assert.doesNotMatch(screen, /\[r\.name, r\.amount\]/);
});

test("материалы записей — своё имя и свой ключ", () => {
  assert.match(screen, /name: "Материалы записей"/);
  assert.match(screen, /expenseBefore\.set\(MATERIAL_ROW_ID, compare\.materialCost\)/);
});
