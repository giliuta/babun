import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  checkoutIdempotencyKey,
  duplicateVerdict,
  liveSubscriptionOf,
  openTariffSessions,
} from "../../../../../supabase/functions/_shared/tariff-duplicates";

// ОДНА ПОДПИСКА НА КАЛЕНДАРЬ. Две вкладки оплаты, «Назад → Оплатить ещё раз»,
// владелец и партнёр одновременно — пока вебхук не записал первую оплату,
// `tariff-checkout` видел «подписки нет» и открывал вторую страницу Stripe;
// оплачены обе — списывали обе, а в аккаунте была видна одна.
//
// Правила лежат в `_shared/tariff-duplicates.ts` (их берут обе функции), а
// здесь же сторож, что функции их действительно зовут и в нужном порядке.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const FN = readFileSync(path.join(ROOT, "supabase/functions/tariff-checkout/index.ts"), "utf8");
const WEBHOOK = readFileSync(path.join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

const T = "tenant-1";
const C = "team-1";
const sub = (id: string, status: string, created: number, tenant: string | null = T, team: string | null = C) => ({
  id,
  status,
  created,
  metadata: { ...(tenant ? { tenant_id: tenant } : {}), ...(team ? { team_id: team } : {}) },
});

describe("живая подписка в Stripe", () => {
  test("находится по статусу, самая свежая из живых", () => {
    assert.equal(liveSubscriptionOf([]), null);
    assert.equal(liveSubscriptionOf([sub("a", "canceled", 1), sub("b", "incomplete_expired", 2)]), null);
    assert.equal(liveSubscriptionOf([sub("a", "active", 1), sub("b", "trialing", 5), sub("c", "canceled", 9)])?.id, "b");
    assert.equal(liveSubscriptionOf([sub("a", "past_due", 1)])?.id, "a");
  });

  test("гасятся только открытые страницы оплаты ЭТОГО календаря, не других и не SMS", () => {
    const ids = openTariffSessions(
      [
        { id: "cs_tariff", status: "open", mode: "subscription", metadata: { kind: "tariff", team_id: C } },
        { id: "cs_other_calendar", status: "open", mode: "subscription", metadata: { kind: "tariff", team_id: "team-2" } },
        { id: "cs_done", status: "complete", mode: "subscription", metadata: { kind: "tariff", team_id: C } },
        { id: "cs_sms", status: "open", mode: "payment", metadata: { kind: "sms" } },
        { id: "cs_other", status: "open", mode: "subscription", metadata: {} },
      ],
      C,
    );
    assert.deepEqual(ids, ["cs_tariff"]);
  });
});

describe("ключ идемпотентности страницы оплаты", () => {
  const base = {
    tenantId: T,
    teamId: C,
    priceId: "price_1",
    trialEnd: null,
    returnUrl: "https://babun.app/pay/done",
    superseded: [] as string[],
    nowMs: 1_700_000_000_000,
  };

  test("два одновременных нажатия — один ключ, то есть одна страница", () => {
    assert.equal(checkoutIdempotencyKey(base), checkoutIdempotencyKey({ ...base, nowMs: base.nowMs + 1_000 }));
  });

  test("повтор после гашения старой страницы — новый ключ, а не погашенная страница", () => {
    assert.notEqual(checkoutIdempotencyKey(base), checkoutIdempotencyKey({ ...base, superseded: ["cs_old"] }));
  });

  test("другое содержимое или другая минута — другой ключ; ключ влезает в предел Stripe", () => {
    const k = checkoutIdempotencyKey(base);
    assert.notEqual(k, checkoutIdempotencyKey({ ...base, teamId: "team-2" }));
    assert.notEqual(k, checkoutIdempotencyKey({ ...base, priceId: "price_year" }));
    assert.notEqual(k, checkoutIdempotencyKey({ ...base, nowMs: base.nowMs + 60_000 }));
    const long = checkoutIdempotencyKey({ ...base, superseded: Array.from({ length: 20 }, (_, i) => `cs_${"x".repeat(60)}${i}`) });
    assert.ok(long.length <= 255, `ключ ${long.length} символов`);
  });
});

describe("вебхук: вторая живая подписка", () => {
  test("вторая живая подписка того же календаря — снимается, тариф остаётся на записанной", () => {
    const v = duplicateVerdict({ tenantId: T, teamId: C, current: sub("first", "active", 10), fresh: sub("second", "active", 20) });
    assert.deepEqual(v, { kind: "cancel", subscriptionId: "second" });
    // Порядок событий не важен: пришла раньше та, что старше, — снимается она.
    const late = duplicateVerdict({ tenantId: T, teamId: C, current: sub("second", "active", 20), fresh: sub("first", "trialing", 10) });
    assert.deepEqual(late, { kind: "cancel", subscriptionId: "first" });
  });

  test("записанная не живая или её нет — календарь переходит на живую", () => {
    assert.deepEqual(duplicateVerdict({ tenantId: T, teamId: C, current: null, fresh: sub("s", "active", 1) }), { kind: "adopt" });
    assert.deepEqual(
      duplicateVerdict({ tenantId: T, teamId: C, current: sub("old", "canceled", 1), fresh: sub("s", "active", 2) }),
      { kind: "adopt" },
    );
  });

  test("мёртвая подписка тариф не трогает и не отменяется", () => {
    assert.deepEqual(
      duplicateVerdict({ tenantId: T, teamId: C, current: sub("cur", "active", 1), fresh: sub("dead", "canceled", 2) }),
      { kind: "ignore" },
    );
  });

  test("вторая без меток аккаунта и календаря (не наша оплата) — только тревога, деньги не трогаем", () => {
    const v = duplicateVerdict({ tenantId: T, teamId: C, current: sub("cur", "active", 1), fresh: sub("legacy", "active", 2, null, null) });
    assert.deepEqual(v, { kind: "alarm", adopt: true });
    // Перенесённая с аккаунта подписка несёт аккаунт, но не календарь.
    const moved = duplicateVerdict({ tenantId: T, teamId: C, current: sub("cur", "active", 1), fresh: sub("moved", "active", 2, T, null) });
    assert.deepEqual(moved, { kind: "alarm", adopt: true });
    const foreign = duplicateVerdict({ tenantId: T, teamId: C, current: sub("cur", "active", 5), fresh: sub("x", "active", 2, "other") });
    assert.deepEqual(foreign, { kind: "alarm", adopt: false });
  });
});

describe("функции зовут правила в нужном порядке", () => {
  test("tariff-checkout: Stripe спрашивается ДО создания страницы, страница — с ключом", () => {
    const create = FN.indexOf('"checkout/sessions", form');
    const live = FN.indexOf("liveSubscriptionOf(ofCalendar)");
    const expire = FN.indexOf("/expire`");
    assert.ok(live > 0 && live < create, "живая подписка проверяется после создания страницы или не проверяется");
    assert.ok(expire > 0 && expire < create, "старые страницы не гасятся до новой");
    assert.match(FN, /"checkout\/sessions", form, idempotencyKey\)/);
    assert.match(FN, /"Idempotency-Key": idempotencyKey/);
    assert.match(FN, /superseded,\s*\n\s*nowMs/);
    // Уже оплачено — ответ, который понимает приложение из магазина без обновления.
    const answer = FN.slice(live, live + 200);
    assert.ok(/\)\)(?: \{\s*| )return json\(200, \{ changed: true \}\)/.test(answer), "уже оплачено — не ответ «изменено»");
  });

  test("вебхук: возврат раньше отмены, у обоих ключи идемпотентности", () => {
    const body = WEBHOOK.slice(WEBHOOK.indexOf("async function refundAndCancelDuplicate"));
    const refund = body.indexOf("stripe.refunds.create(");
    const cancel = body.indexOf("stripe.subscriptions.cancel(");
    assert.ok(refund > 0 && cancel > refund, "отмена раньше возврата: повтор события уже не вернул бы деньги");
    assert.match(body, /idempotencyKey: `babun-duplicate-refund-\$\{subscriptionId\}`/);
    assert.match(body, /idempotencyKey: `babun-duplicate-cancel-\$\{subscriptionId\}`/);
    assert.match(body, /prorate: false, invoice_now: false/);
    assert.match(WEBHOOK, /duplicateVerdict\(\{ tenantId, teamId, current: currentSub, fresh \}\)/);
  });
});
