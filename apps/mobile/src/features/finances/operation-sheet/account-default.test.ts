import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// НОВАЯ ОПЕРАЦИЯ НЕ ВСТРЕЧАЕТ ЧУЖИМ СЧЁТОМ (аудит 035, F-50). Счёт, которого
// человек не выбирал и который не обслуживает команду операции (остался от
// прошлого открытия или прежней команды), заменяется счётом команды — иначе
// форма открывалась красным «Сохранённый счёт не подходит». Хук тянет
// react-query — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(resolve(here, "use-operation-accounts.ts"), "utf8");

test("дефолт счёта заменяет нетронутый счёт чужой команды", () => {
  assert.match(hook, /if \(accountId !== null && teamAccounts\.some\(\(a\) => a\.id === accountId\)\) return;/);
  assert.doesNotMatch(hook, /if \(!teamId \|\| accountId !== null\) return;/);
});

test("счёт с карточки счёта дефолт не перебивает", () => {
  assert.match(hook, /if \(defaultAccountId && accountId === defaultAccountId\) return;/);
});
