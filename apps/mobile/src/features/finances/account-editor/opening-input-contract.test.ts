import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { moneyInputProblem } from "@babun/shared/common/utils/money";

// ОСТАТОК НОВОГО СЧЁТА: причина отказа — настоящая, поле —
// без полосы текстовых подсказок (K-22). Лист тянет react-native — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "CreateAccountSheet.tsx"), "utf8");

test("огромная сумма — «слишком большая», а не «два знака после запятой»", () => {
  const problem = moneyInputProblem("-99999999999.99", { allowNegative: true, allowZero: true });
  assert.match(problem ?? "", /слишком большая/);
  assert.match(sheet, /moneyInputProblem\(opening, \{ allowNegative: true, allowZero: true \}\)/);
});

test("поле остатка не показывает полосу подсказок", () => {
  assert.match(sheet, /keyboardType=\{SIGNED_NUMBER_KEYBOARD\}\s+autoCorrect=\{false\}\s+spellCheck=\{false\}/);
});
