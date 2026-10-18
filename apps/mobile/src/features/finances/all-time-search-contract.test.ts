import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Поиск за всё время ищет то, что обещает шапка: «Сумма, счёт, заметка».
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "queries.ts"), "utf8");

test("поиск за всё время — заметка, сумма со знаком и без, счёт по имени", () => {
  assert.match(src, /`notes\.ilike\.\$\{orValue\(containsPattern\(query\)\)\}`/);
  assert.match(src, /`amount\.eq\.\$\{amount\}`, `amount\.eq\.\$\{-amount\}`/);
  assert.match(src, /`account_id\.in\.\(\$\{ids\.join\(","\)\}\)`/);
  // Значения в кавычках: запятая «12,50» не рвёт фильтр на два условия.
  assert.match(src, /function orValue\(value: string\): string/);
});
