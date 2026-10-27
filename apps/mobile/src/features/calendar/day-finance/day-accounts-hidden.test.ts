import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// СКРЫТЫЙ СЧЁТ — ТОЛЬКО НА СТРАНИЦЕ «СЧЕТА». В разбивке
// «Финансов дня» его плитки с нулём нет; деньги дня на нём всё равно видны —
// `moneyByAccount` ставит такие счета в хвост. Хук тянет react-query — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));

test("порядок счетов дня не берёт скрытые", () => {
  const hook = readFileSync(resolve(here, "use-day-accounts.ts"), "utf8");
  assert.match(hook, /\.filter\(\(a\) => a\.is_active && !a\.is_hidden && /);
});
