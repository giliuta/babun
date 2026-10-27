import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { CALENDAR_PRICE, TIER_CARDS, TIER_LIMITS } from "@/session/tiers";

// ЦЕНА НА СТРАНИЦЕ «ТАРИФ» = ЦЕНА, КОТОРУЮ СПИШЕТ STRIPE (одна цена за
// календарь, количество = живые календари).
//
// Страница показывает цены из `tiers.ts`, а заводит цену в Stripe и
// списывает деньги функция `tariff-checkout` — своим списком в центах. Два
// списка разойдутся молча: человек увидит €29,99, а заплатит другое. Этот
// сторож читает функцию и сверяет обе стороны, а заодно лимит партнёров
// (отказ «сначала уберите лишних» при понижении тарифа).

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

describe("цена за календарь: страница и Stripe", () => {
  test("одна карточка — «Календарь», цена как у функции, в месяц и за год", () => {
    assert.equal(TIER_CARDS.length, 1);
    const card = TIER_CARDS[0]!;
    assert.equal(card.monthly, "€9,99");
    assert.equal(card.yearlyMonthly, "€7,99");
    assert.equal(fnPrice("month"), cents(card.monthly));
    assert.equal(fnPrice("year"), cents(card.yearlyMonthly) * 12);
    assert.equal(cents(card.monthly), Math.round(CALENDAR_PRICE.monthly * 100));
  });

  test("в подписке столько календарей, сколько живых; людей не считаем", () => {
    assert.match(FN, /"line_items\[0\]\[quantity\]": String\(quantity\)/);
    assert.doesNotMatch(FN, /too_many_partners/);
    assert.match(FN, /proration_behavior: "none"/);
    assert.equal(TIER_LIMITS.max.partners, 1000);
  });

  test("сверка количества не трогает старую подписку с плоской ценой", () => {
    // Иначе Про за €X при трёх календарях стал бы стоить 3 × €X.
    const sync = FN.slice(FN.indexOf('if (action === "sync")'), FN.indexOf("const period: Period"));
    const guard = sync.indexOf("/^babun_calendar_/.test(item.price?.lookup_key");
    assert.ok(guard > 0, "sync меняет количество, не проверив цену «за календарь»");
    assert.ok(guard < sync.indexOf('"items[0][quantity]"'), "проверка цены стоит после записи количества");
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

// КОЛИЧЕСТВО = КАЛЕНДАРИ С РАБОТОЙ, А НЕ «ОДИН ПРИ ОШИБКЕ». Подсчёт, который
// при отказе чтения молча возвращает 1, выставляет счёт за один календарь при
// пяти рабочих: ошибка должна дойти до 5xx (оплата) и до повтора Stripe
// (вебхук перед счётом). Само правило и его сверка с приложением —
// `paid-calendars-parity.test.ts`.
describe("подсчёт календарей для подписки", () => {
  test("обе функции считают общим помощником, ошибка чтения — исключение", () => {
    const helper = readFileSync(path.join(ROOT, "supabase/functions/_shared/paid-calendars.ts"), "utf8");
    assert.match(helper, /if \(error \|\| typeof data !== "number"\) \{\s*throw new Error/, "сбой подсчёта превращается в 1");
    for (const [name, source] of [["tariff-checkout", FN], ["stripe-webhook", WEBHOOK]] as const) {
      assert.match(source, /await paidCalendars\((service|sbs), tenantId\)/, `${name}: считает не общим помощником`);
      assert.doesNotMatch(source, /typeof count === "number" \? count : 1/, `${name}: остался молчаливый откат на 1`);
    }
  });
});

describe("период оплаты доходит до Stripe", () => {
  const CLIENT = readFileSync(path.join(ROOT, "apps/mobile/src/features/tariffs/use-tariff.ts"), "utf8");

  test("приложение шлёт выбранный период, а не всегда «месяц»", () => {
    assert.doesNotMatch(CLIENT, /period: "month"/);
    assert.match(CLIENT, /\.\.\.\(period \? \{ period \} : null\)/);
  });

  test("без периода живая подписка остаётся на своём — год не превращается в месяц", () => {
    const live = FN.slice(FN.indexOf("if (live && tenant.stripe_subscription_id)"), FN.indexOf("// Клиент Stripe аккаунта"));
    assert.match(live, /chosen \?\? \(item\.price\?\.recurring\?\.interval === "year" \? "year" : "month"\)/);
    assert.match(FN, /body\.period === "year" \? "year" : body\.period === "month" \? "month" : null/);
  });
});
