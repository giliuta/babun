import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pluralRu } from "@babun/shared/common/utils/plural-ru";

// ИТОГ ИМПОРТА: ГЛАГОЛ — ТЕМ ЖЕ ПРАВИЛОМ ЧИСЛА, ЧТО «СТРОКА» (13.10, нашла
// сессия 025). `errorCount === 1 ? "прошла" : "прошли"` давало «21 строка не
// прошли»; своё сравнение запрещено правилом 8.1 AGENTS.md.

const here = dirname(fileURLToPath(import.meta.url));
const wizard = readFileSync(resolve(here, "ImportWizardSheet.tsx"), "utf8");
const PASSED = ["прошла", "прошли", "прошли"] as const;

test("итог импорта не сравнивает число сам", () => {
  assert.doesNotMatch(wizard, /errorCount === 1 \?/);
  assert.match(wizard, /не \{passedRu\(errorCount\)\}/);
  assert.match(wizard, /pluralRu\(n, \["прошла", "прошли", "прошли"\]\)/);
});

test("форма глагола идёт за числом, как у «строки»", () => {
  assert.equal(pluralRu(1, PASSED), "прошла");
  assert.equal(pluralRu(21, PASSED), "прошла");
  assert.equal(pluralRu(11, PASSED), "прошли");
  assert.equal(pluralRu(3, PASSED), "прошли");
  assert.equal(pluralRu(25, PASSED), "прошли");
});
