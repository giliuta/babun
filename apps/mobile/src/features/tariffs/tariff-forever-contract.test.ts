import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ТАРИФ «НАВСЕГДА» НЕ ВИДИТ ЦЕН. Аккаунту, которому тариф выдан без оплаты,
// цена «€9,99 в месяц» и «За год — €7,99» на странице тарифа календаря
// обещали бы списание, которого не будет: он не платит. Цены прячутся по
// тому же признаку, что гасит кнопку оплаты (`state.forever`).

const screen = readFileSync(join(__dirname, "TariffScreen.tsx"), "utf8");

test("цены на карточке календаря не показываются тарифу навсегда", () => {
  const card = screen.slice(screen.indexOf("function PriceCard("));
  assert.match(card, /const priced = !state\.forever;/);
  assert.match(card, /\{priced \? \(\s*<>\s*<Text[^>]*>\{card\.monthly\}/);
  assert.match(card, /\{priced \? \(\s*<Text[^>]*>\{`За год — \$\{card\.yearlyMonthly\} в месяц`\}/);
  assert.match(card, /accessibilityLabel=\{priced \? `\$\{card\.name\}, \$\{card\.monthly\} в месяц` : card\.name\}/);
});
