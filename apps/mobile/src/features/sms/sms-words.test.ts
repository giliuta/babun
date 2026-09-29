import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyPatch,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  smsErrorText,
  teamStats,
} from "./sms-model";
import { balanceWords, costWords, monthWords, priceOf, statusWords, triggerWords } from "./sms-words";

describe("слова страницы SMS", () => {
  test("баланс — в штуках SMS и бесплатных", () => {
    assert.equal(balanceWords(1240, 10, 10), "≈ 124 SMS · 10 бесплатных");
    assert.equal(balanceWords(5, 0, 10), "≈ 0 SMS");
    assert.equal(balanceWords(100, 1, 10), "≈ 10 SMS · 1 бесплатная");
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

  test("повод в истории", () => {
    assert.equal(triggerWords("reschedule"), "Перенос");
    assert.equal(triggerWords("repeat"), "Пора повторить");
    assert.equal(triggerWords("manual"), "Вручную");
    assert.equal(monthWords(new Date(2026, 8, 24)), "Сентябрь");
  });
});

const OWNER = {
  enabled: true,
  team_ids: ["t1", "t3"],
  price_cents: 12,
  balance_cents: 500,
  free_left: 3,
  template_counts: { t1: 6, t3: 2, bad: "x" },
  month: { count: 3, cents: 48 },
  teams: [{ team_id: "t3", count: 3, segments: 4, cents: 48, delivered: 2, failed: 1 }],
};

describe("ответ базы", () => {
  test("сотруднику баланс не приходит — owner пуст", () => {
    const member = parseSmsAccount({ service_on: true, enabled: true, team_ids: ["t1"], price_cents: 12, can_pay: true });
    assert.equal(member.owner, null);
    assert.deepEqual(member.teamIds, ["t1"]);
  });

  test("владельцу — счёт по командам и сколько у них шаблонов", () => {
    const a = parseSmsAccount(OWNER);
    assert.equal(a.owner?.balanceCents, 500);
    assert.deepEqual(a.owner?.templateCounts, { t1: 6, t3: 2 }, "не число — отброшено");
    assert.deepEqual(teamStats(a, "t3"), { teamId: "t3", count: 3, segments: 4, cents: 48, delivered: 2, failed: 1 });
    assert.equal(teamStats(a, "t1").count, 0, "команда без сообщений — нули");
  });

  test("тумблер откликается сразу: черновик правки", () => {
    const before = parseSmsAccount({ enabled: false, team_ids: [], balance_cents: 0 });
    const after = applyPatch(before, { enabled: true, team_ids: ["t1"] });
    assert.equal(after.enabled, true);
    assert.deepEqual(after.teamIds, ["t1"]);
    assert.equal(after.owner?.balanceCents, 0);
  });

  test("история читается и без необязательных полей", () => {
    const [row] = parseSmsHistory([{ id: "1", created_at: "2026-09-24T10:00:00Z", status: "sent", cost_cents: 20, trigger: "manual" }]);
    assert.equal(row.status, "sent");
    assert.equal(row.clientName, null);
    assert.equal(row.teamId, null);
    assert.equal(row.sendAfter, null);
    assert.equal(parseSmsHistory(null).length, 0);
  });

  test("SMS записи: шаблоны команды и сообщения, неушедшее — с шаблоном", () => {
    const log = parseSmsRecordLog({
      templates: [{ id: "a", team_id: "t1", name: "Подтверждение", body: "[Имя], вы записаны", trigger: "created" }],
      messages: [{ id: "m1", status: "queued", trigger: "reminder", template_body: "Напоминаем [Время]", template_name: "Накануне", send_after: "2026-09-25T05:00:00Z" }],
    });
    assert.equal(log.templates[0]?.body, "[Имя], вы записаны");
    assert.equal(log.messages[0]?.templateName, "Накануне");
    assert.equal(log.messages[0]?.templateBody, "Напоминаем [Время]");
    assert.equal(log.messages[0]?.body, null);
    assert.deepEqual(parseSmsRecordLog(null), { templates: [], messages: [], clientAnswer: null, clientAnsweredAt: null });
  });

  test("отказы базы — словами", () => {
    assert.equal(smsErrorText(new Error("sms:funds")), "Не хватает баланса SMS");
    assert.equal(smsErrorText(new Error("sms:opt_out")), "Клиент просил не присылать SMS");
    assert.equal(smsErrorText(new Error("что-то")), "что-то");
  });
});
