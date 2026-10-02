import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { TIER_CARDS, TIER_LIMITS } from "./tiers";

// ЦЕНА НА СТРАНИЦЕ «ТАРИФ» = ЦЕНА, КОТОРУЮ СПИШЕТ STRIPE.
//
// Страница показывает цены из `tiers.ts`, а заводит цену в Stripe и
// списывает деньги функция `tariff-checkout` — своим списком в центах. Два
// списка разойдутся молча: человек увидит €29.99, а заплатит другое. Этот
// сторож читает функцию и сверяет обе стороны, а заодно лимит партнёров
// (отказ «сначала уберите лишних» при понижении тарифа).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const FN = readFileSync(path.join(ROOT, "supabase/functions/tariff-checkout/index.ts"), "utf8");
const WEBHOOK = readFileSync(path.join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

const cents = (euro: string) => Math.round(Number(euro.replace("€", "")) * 100);

function fnPrice(tier: string, period: "month" | "year"): number {
  const row = new RegExp(`${tier}: \\{ month: ([0-9* ]+), year: ([0-9* ]+) \\}`).exec(FN);
  assert.ok(row, `в tariff-checkout нет цены тарифа ${tier}`);
  const expr = period === "month" ? row[1] : row[2];
  return expr.split("*").map((part) => Number(part.trim())).reduce((a, b) => a * b, 1);
}

describe("цены тарифов: страница и Stripe", () => {
  for (const card of TIER_CARDS) {
    test(`${card.name}: в месяц и за год`, () => {
      assert.equal(fnPrice(card.tier, "month"), cents(card.monthly));
      assert.equal(fnPrice(card.tier, "year"), cents(card.yearlyMonthly) * 12);
    });
  }

  test("лимит партнёров при смене тарифа — тот же, что у приложения", () => {
    const row = /const PARTNERS: Record<Tier, number> = \{ solo: (\d+), pro: (\d+), max: (\d+) \}/.exec(FN);
    assert.ok(row, "в tariff-checkout нет лимитов партнёров");
    assert.deepEqual(
      [Number(row[1]), Number(row[2]), Number(row[3])],
      [TIER_LIMITS.solo.partners, TIER_LIMITS.pro.partners, TIER_LIMITS.max.partners],
    );
  });

  test("вебхук узнаёт тариф по метке цены, которую ставит функция", () => {
    assert.match(FN, /"metadata\[tier\]": tier/);
    assert.match(FN, /lookup_key: lookup/);
    assert.match(WEBHOOK, /price\.metadata\?\.tier/);
    assert.match(WEBHOOK, /\^babun_\(solo\|pro\|max\)_/);
    // Старый Business — теперь Макс, а не бесплатный и не «business».
    assert.match(WEBHOOK, /STRIPE_PRICE_BUSINESS"\)\) return "max"/);
  });
});
