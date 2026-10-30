import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { CALENDAR_CARD, CALENDAR_PRICE, PARTNER_LIMIT } from "@/session/tiers";

// ЦЕНА НА СТРАНИЦЕ ТАРИФА = ЦЕНА, КОТОРУЮ СПИШЕТ STRIPE (подписка у каждого
// календаря, количество 1).
//
// Страница показывает цену из `tiers.ts`, а заводит цену в Stripe и
// списывает деньги функция `tariff-checkout` — своим списком в центах. Два
// списка разойдутся молча: человек увидит €9,99, а заплатит другое. Этот
// сторож читает функции и сверяет обе стороны.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const FN = readFileSync(path.join(ROOT, "supabase/functions/tariff-checkout/index.ts"), "utf8");
const WEBHOOK = readFileSync(path.join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

// Цена — в формате денег продукта: «€9,99» (запятая, неразрывный пробел в
// тысячах).
const cents = (euro: string) => Math.round(Number(euro.replace("€", "").replace(/\s/g, "").replace(",", ".")) * 100);

function fnPrice(period: "month" | "year"): number {
  const row = /const CALENDAR_PRICE: Record<Period, number> = \{ month: ([0-9* ]+), year: ([0-9* ]+) \}/.exec(FN);
  assert.ok(row, "в tariff-checkout нет цены календаря");
  const expr = period === "month" ? row[1] : row[2];
  return expr.split("*").map((part) => Number(part.trim())).reduce((a, b) => a * b, 1);
}

describe("цена календаря: страница и Stripe", () => {
  test("карточка «Календарь», цена как у функции, в месяц и за год", () => {
    assert.equal(CALENDAR_CARD.monthly, "€9,99");
    assert.equal(CALENDAR_CARD.yearlyMonthly, "€7,99");
    assert.equal(fnPrice("month"), cents(CALENDAR_CARD.monthly));
    assert.equal(fnPrice("year"), cents(CALENDAR_CARD.yearlyMonthly) * 12);
    assert.equal(cents(CALENDAR_CARD.monthly), Math.round(CALENDAR_PRICE.monthly * 100));
  });

  test("у каждого календаря своя подписка на один календарь; людей не считаем", () => {
    assert.match(FN, /"line_items\[0\]\[quantity\]": "1"/);
    assert.match(FN, /"subscription_data\[metadata\]\[team_id\]": teamId/);
    assert.match(FN, /if \(!teamId\) return json\(400, \{ error: "team_required" \}\);/);
    assert.doesNotMatch(FN, /paidCalendars|paid_calendar_count/);
    assert.match(FN, /proration_behavior: "none"/);
    assert.equal(PARTNER_LIMIT.max, 1000);
  });

  test("архивный календарь не платит следующий период", () => {
    // Сразу после архива — отмена в конце срока (sync), перед счётом —
    // страховка вебхука.
    const sync = FN.slice(FN.indexOf('if (action === "sync")'), FN.indexOf('if (!teamId) return json(400'));
    assert.match(sync, /cancel_at_period_end: "true",\s*"metadata\[cancelled_by\]": "archive"/);
    // Вернули из архива — снимается только своя отмена, не владельца.
    assert.match(sync, /!archived && sub\.cancel_at_period_end === true && ours/);
    assert.match(WEBHOOK, /if \(event\.type !== "invoice\.upcoming"\) return;/);
    assert.match(WEBHOOK, /if \(team\?\.is_active === true\) return;/);
  });

  test("вебхук пишет подписку в строку календаря, а не в аккаунт", () => {
    assert.match(FN, /"metadata\[tier\]": PAID_TIER/);
    assert.match(FN, /const PAID_TIER = "max"/);
    assert.match(FN, /lookup_key: lookup/);
    assert.match(WEBHOOK, /\^babun_calendar_\//);
    assert.match(WEBHOOK, /\.from\("calendar_subscriptions"\)\s*\.upsert\(/);
    assert.match(WEBHOOK, /onConflict: "tenant_id,team_id"/);
    // Цена не наша — доступа нет, как бы ни называлась стадия подписки.
    assert.match(WEBHOOK, /priceToTier\(item\?\.price\) === "free" \? "incomplete"/);
    // Аккаунту вебхук пишет только клиента Stripe.
    assert.match(WEBHOOK, /interface AccountFields \{\s*stripe_customer_id\?: string;\s*\}/);
    // Старый Business — по-прежнему Макс, а не бесплатный и не «business».
    assert.match(WEBHOOK, /STRIPE_PRICE_BUSINESS"\)\) return "max"/);
  });
});

describe("период оплаты доходит до Stripe", () => {
  const CLIENT = readFileSync(path.join(ROOT, "apps/mobile/src/features/tariffs/use-tariff.ts"), "utf8");

  test("приложение шлёт выбранный период и календарь", () => {
    assert.doesNotMatch(CLIENT, /period: "month"/);
    assert.match(CLIENT, /\.\.\.\(input\.period \? \{ period: input\.period \} : null\)/);
    assert.match(CLIENT, /team_id: input\.teamId/);
  });

  test("без периода живая подписка остаётся на своём — год не превращается в месяц", () => {
    const live = FN.slice(FN.indexOf("if (row && LIVE_TARIFF_STATUSES.has(String(row.status)))"), FN.indexOf("// Клиент Stripe аккаунта"));
    assert.match(live, /chosen \?\? \(item\.price\?\.recurring\?\.interval === "year" \? "year" : "month"\)/);
    assert.match(FN, /body\.period === "year" \? "year" : body\.period === "month" \? "month" : null/);
  });
});
