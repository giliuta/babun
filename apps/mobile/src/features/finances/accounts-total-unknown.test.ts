import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// НЕИЗВЕСТНЫЙ ОСТАТОК — ПРОЧЕРК, А НЕ «€0». Партнёр видит
// строку счёта по праву «Доход/Расход», а остаток ему сервер может не назвать:
// плитка счёта печатала «€0», а плитка «Счета» складывала этот ноль в итог.
// Модули тянут react-native — по исходнику.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

test("итог плитки «Счета» — null, если хоть один остаток неизвестен; сумма в центах", () => {
  const ui = read("account-ui.ts");
  assert.match(ui, /if \(accounts\.some\(\(a\) => !a\.balance_known\)\) return null;\s*return sumAccountBalances\(accounts\);/);
  const overview = read("FinanceOverview.tsx");
  assert.match(overview, /accounts\.total === null \? UNKNOWN_BALANCE_TEXT : formatEUR\(accounts\.total\)/);
});

test("плитки счетов печатают остаток через balanceText", () => {
  const panel = read("AccountsPanel.tsx");
  assert.match(panel, /amount=\{balanceText\(account, money\)\}/);
  assert.doesNotMatch(panel, /money\(account\.balance\)/);
});
