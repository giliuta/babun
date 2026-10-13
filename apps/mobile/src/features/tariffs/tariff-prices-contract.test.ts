import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { CALENDAR_PRICE, TIER_CARDS, TIER_LIMITS } from "@/session/tiers";

// ЦЕНА НА СТРАНИЦЕ «ТАРИФ» = ЦЕНА, КОТОРУЮ СПИШЕТ STRIPE (с 12.10 — одна
// цена за календарь, количество = живые календари).
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

function fnPrice(period: "month" | "year"): number {
  const row = /const CALENDAR_PRICE: Record<Period, number> = \{ month: ([0-9* ]+), year: ([0-9* ]+) \}/.exec(FN);
  assert.ok(row, "в tariff-checkout нет цены календаря");
  const expr = period === "month" ? row[1] : row[2];
  return expr.split("*").map((part) => Number(part.trim())).reduce((a, b) => a * b, 1);
}

describe("цена за календарь: страница и Stripe", () => {
  test("одна карточка — «Календарь», цена как у функции, в месяц и за год", () => {
    assert.equal(TIER_CARDS.length, 1);
    const card = TIER_CARDS[0]!;
    assert.equal(card.monthly, "€9.99");
    assert.equal(card.yearlyMonthly, "€7.99");
    assert.equal(fnPrice("month"), cents(card.monthly));
    assert.equal(fnPrice("year"), cents(card.yearlyMonthly) * 12);
    assert.equal(cents(card.monthly), Math.round(CALENDAR_PRICE.monthly * 100));
  });

  test("в подписке столько календарей, сколько живых; людей не считаем", () => {
    assert.match(FN, /"line_items\[0\]\[quantity\]": String\(quantity\)/);
    assert.match(FN, /\.eq\("is_active", true\)/);
    assert.doesNotMatch(FN, /too_many_partners/);
    assert.match(FN, /proration_behavior: "none"/);
    assert.equal(TIER_LIMITS.max.partners, 1000);
  });

  test("вебхук узнаёт цену за календарь и пишет число календарей", () => {
    assert.match(FN, /"metadata\[tier\]": PAID_TIER/);
    assert.match(FN, /const PAID_TIER = "max"/);
    assert.match(FN, /lookup_key: lookup/);
    assert.match(WEBHOOK, /\^babun_calendar_\//);
    assert.match(WEBHOOK, /paid_calendars: item\?\.quantity \?\? null/);
    assert.match(WEBHOOK, /"invoice\.upcoming"/);
    // Старый Business — по-прежнему Макс, а не бесплатный и не «business».
    assert.match(WEBHOOK, /STRIPE_PRICE_BUSINESS"\)\) return "max"/);
  });
});
