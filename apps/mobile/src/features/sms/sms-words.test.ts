import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyPatch,
  applyRule,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  smsErrorText,
  teamEventState,
  teamStats,
} from "./sms-model";
import {
  balanceWords,
  costWords,
  hoursWords,
  monthWords,
  priceOf,
  quietWords,
  statusWords,
  timingWords,
  triggerWords,
} from "./sms-words";

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

  test("срок события: сразу, за N, через N", () => {
    assert.equal(timingWords("new_appointment", null), "Сразу");
    assert.equal(timingWords("reminder", 24), "За сутки");
    assert.equal(timingWords("reminder_2", 2), "За 2 часа");
    assert.equal(timingWords("thank_you", 2), "Через 2 часа");
    assert.equal(timingWords("thank_you", 24), "Через сутки");
    assert.equal(timingWords("repeat", 6), "Через 6 месяцев");
    assert.equal(timingWords("repeat", 1), "Через 1 месяц");
  });

  test("тихие часы и повод в истории", () => {
    assert.equal(quietWords(21, 8), "21:00–08:00");
    assert.equal(quietWords(0, 0), "Нет");
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
  quiet_from: 21,
  quiet_to: 8,
  events: [
    { event: "new_appointment", mode: "on", body: "Записаны [Имя]", timing: null, custom: false },
    { event: "reminder", mode: "on", body: "Напоминаем", timing: 24, custom: false },
    { event: "cancellation", mode: "off", body: "Отмена", timing: null, custom: false },
    { event: "unknown", mode: "on", body: "x" },
  ],
  team_rules: [
    { team_id: "t3", event: "new_appointment", mode: "on", body: "Команда 3" },
    { team_id: "t1", event: "reminder", mode: "off", body: null },
  ],
  month: { count: 3, cents: 48 },
  teams: [{ team_id: "t3", count: 3, segments: 4, cents: 48, delivered: 2, failed: 1 }],
};

describe("ответ базы", () => {
  test("сотруднику баланс не приходит — owner пуст", () => {
    const member = parseSmsAccount({ service_on: true, enabled: true, team_ids: ["t1"], price_cents: 12, can_pay: true });
    assert.equal(member.owner, null);
    assert.deepEqual(member.teamIds, ["t1"]);
  });

  test("владельцу — события, свои тексты команд и счёт по командам", () => {
    const a = parseSmsAccount(OWNER);
    assert.equal(a.owner?.balanceCents, 500);
    assert.equal(a.owner?.events.length, 3, "незнакомое событие отброшено");
    assert.equal(a.owner?.events[1]?.timing, 24);
    assert.equal(a.owner?.teamRules.length, 2);
    assert.deepEqual(teamStats(a, "t3"), { teamId: "t3", count: 3, segments: 4, cents: 48, delivered: 2, failed: 1 });
    assert.equal(teamStats(a, "t1").count, 0, "команда без сообщений — нули");
  });

  test("что шлёт команда: свой текст, как у компании, не отправлять", () => {
    const a = parseSmsAccount(OWNER);
    assert.deepEqual(teamEventState(a, "t3", "new_appointment"), { mode: "on", sends: true, body: "Команда 3" });
    assert.deepEqual(teamEventState(a, "t1", "new_appointment"), { mode: "inherit", sends: true, body: "Записаны [Имя]" });
    assert.equal(teamEventState(a, "t1", "reminder").sends, false);
    assert.equal(teamEventState(a, "t3", "reminder").sends, true);
    assert.deepEqual(teamEventState(a, "t3", "cancellation"), { mode: "inherit", sends: false, body: "Отмена" });
  });

  test("тумблер откликается сразу: черновик правки", () => {
    const before = parseSmsAccount({ enabled: false, team_ids: [], balance_cents: 0 });
    const after = applyPatch(before, { enabled: true, team_ids: ["t1"], quiet_from: 22, quiet_to: 9 });
    assert.equal(after.enabled, true);
    assert.deepEqual(after.teamIds, ["t1"]);
    assert.equal(after.owner?.quietFrom, 22);
    assert.equal(after.owner?.quietTo, 9);
  });

  test("черновик правки события: компания и команда", () => {
    const a = parseSmsAccount(OWNER);
    const company = applyRule(a, { teamId: "", event: "cancellation", mode: "on", body: " Отменили ", timing: null });
    assert.deepEqual(company.owner?.events[2], { event: "cancellation", on: true, body: "Отменили", timing: null, custom: true });
    const own = applyRule(a, { teamId: "t1", event: "cancellation", mode: "on", body: "Своя отмена" });
    assert.equal(teamEventState(own, "t1", "cancellation").body, "Своя отмена");
    const back = applyRule(own, { teamId: "t1", event: "cancellation", mode: "inherit" });
    assert.equal(teamEventState(back, "t1", "cancellation").mode, "inherit");
    const off = applyRule(a, { teamId: "t3", event: "new_appointment", mode: "off" });
    assert.equal(teamEventState(off, "t3", "new_appointment").sends, false);
    assert.equal(off.owner?.teamRules.length, 2, "правило команды заменено, а не задвоено");
  });

  test("история читается и без необязательных полей", () => {
    const [row] = parseSmsHistory([{ id: "1", created_at: "2026-09-24T10:00:00Z", status: "sent", cost_cents: 20, trigger: "manual" }]);
    assert.equal(row.status, "sent");
    assert.equal(row.clientName, null);
    assert.equal(row.teamId, null);
    assert.equal(row.sendAfter, null);
    assert.equal(parseSmsHistory(null).length, 0);
  });

  test("SMS записи: текст записи и сообщения, неушедшее — с шаблоном", () => {
    const log = parseSmsRecordLog({
      confirm_body: "[Имя], вы записаны",
      messages: [{ id: "m1", status: "queued", trigger: "reminder", template_body: "Напоминаем [Время]", send_after: "2026-09-25T05:00:00Z" }],
    });
    assert.equal(log.confirmBody, "[Имя], вы записаны");
    assert.equal(log.messages[0]?.templateBody, "Напоминаем [Время]");
    assert.equal(log.messages[0]?.body, null);
    assert.deepEqual(parseSmsRecordLog(null), { confirmBody: "", messages: [] });
  });

  test("отказы базы — словами", () => {
    assert.equal(smsErrorText(new Error("sms:funds")), "Не хватает баланса SMS");
    assert.equal(smsErrorText(new Error("sms:opt_out")), "Клиент просил не присылать SMS");
    assert.equal(smsErrorText(new Error("что-то")), "что-то");
  });
});
