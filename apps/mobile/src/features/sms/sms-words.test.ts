import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyPatch, parseSmsAccount, parseSmsHistory, smsErrorText } from "./sms-model";
import { balanceWords, costWords, hoursWords, priceOf, statusWords } from "./sms-words";

describe("слова страницы SMS", () => {
  test("баланс — в штуках SMS и бесплатных", () => {
    assert.equal(balanceWords(1240, 10, 10), "≈ 124 SMS · 10 бесплатных");
    assert.equal(balanceWords(5, 0, 10), "≈ 0 SMS");
    assert.equal(balanceWords(100, 1, 10), "≈ 10 SMS · 1 бесплатная");
  });

  test("когда напоминать — часами и сутками", () => {
    assert.equal(hoursWords(2), "За 2 часа");
    assert.equal(hoursWords(6), "За 6 часов");
    assert.equal(hoursWords(24), "За сутки");
    assert.equal(hoursWords(48), "За 2 дня");
  });

  test("стоимость: бесплатно, евро, у неотправленного — ничего", () => {
    assert.equal(costWords({ status: "sent", costCents: 0, wasFree: true }), "бесплатно");
    assert.equal(costWords({ status: "delivered", costCents: 20, wasFree: false }), "€0,20");
    assert.equal(costWords({ status: "blocked", costCents: 0, wasFree: false }), undefined);
    assert.equal(costWords({ status: "queued", costCents: 0, wasFree: false }), undefined);
    assert.equal(costWords({ status: "failed", costCents: 0, wasFree: false }), undefined);
    assert.equal(priceOf(2, 10), "€0,20");
    assert.equal(statusWords("blocked"), "Не хватило баланса");
  });
});

describe("ответ базы", () => {
  test("сотруднику баланс не приходит — owner пуст", () => {
    const member = parseSmsAccount({ service_on: true, enabled: true, team_ids: ["t1"], price_cents: 10, can_pay: true });
    assert.equal(member.owner, null);
    assert.deepEqual(member.teamIds, ["t1"]);
    const owner = parseSmsAccount({ enabled: false, balance_cents: 500, free_left: 3, reminder_hours: 12, auto_new_template: "tpl" });
    assert.equal(owner.owner?.balanceCents, 500);
    assert.equal(owner.owner?.autoNewTemplate, "tpl");
    assert.equal(owner.owner?.reminderHours, 12);
  });

  test("тумблер откликается сразу: черновик правки", () => {
    const before = parseSmsAccount({ enabled: false, team_ids: [], balance_cents: 0 });
    const after = applyPatch(before, { enabled: true, team_ids: ["t1"], auto_reminder_template: null });
    assert.equal(after.enabled, true);
    assert.deepEqual(after.teamIds, ["t1"]);
    assert.equal(after.owner?.autoReminderTemplate, null);
  });

  test("история читается и без необязательных полей", () => {
    const [row] = parseSmsHistory([{ id: "1", created_at: "2026-09-24T10:00:00Z", status: "sent", cost_cents: 20, trigger: "manual" }]);
    assert.equal(row.status, "sent");
    assert.equal(row.clientName, null);
    assert.equal(parseSmsHistory(null).length, 0);
  });

  test("отказы базы — словами", () => {
    assert.equal(smsErrorText(new Error("sms:funds")), "Не хватает баланса SMS");
    assert.equal(smsErrorText(new Error("sms:opt_out")), "Клиент просил не присылать SMS");
    assert.equal(smsErrorText(new Error("что-то")), "что-то");
  });
});
