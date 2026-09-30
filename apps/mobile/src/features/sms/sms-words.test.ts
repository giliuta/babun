import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyPatch,
  balanceWarning,
  checkoutErrorText,
  FROZEN_WORDS,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  senderProblem,
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

  test("имя отправителя: правила операторов и имена команд из ответа", () => {
    assert.equal(senderProblem("Giliuta"), null);
    assert.equal(senderProblem("  Giliuta   Cy "), null);
    assert.equal(senderProblem(""), null, "пусто — снять имя");
    assert.equal(senderProblem("Гилюта"), "Только латиница, цифры и пробел");
    assert.equal(senderProblem("Giliuta Service"), "Не длиннее 11 знаков");
    assert.equal(senderProblem("12345"), "Нужна хотя бы одна буква");
    const a = parseSmsAccount({ senders: { t1: "Giliuta", t3: "", t4: 7 } });
    assert.deepEqual(a.senders, { t1: "Giliuta" });
    assert.equal(smsErrorText(new Error("sms:sender")), "У команды не указано имя отправителя");
    assert.equal(smsErrorText(new Error("sms:sender_format")), "Имя отправителя: латиница, цифры, до 11 знаков");
    assert.equal(smsErrorText(new Error("sms:sender_taken")), "Это имя занято — выберите другое");
    assert.equal(smsErrorText(new Error("sms:country")), "На номера этой страны SMS не отправляются");
    assert.equal(smsErrorText(new Error("sms:limit")), "На сегодня предел SMS сотрудника исчерпан");
  });

  test("предупреждение о балансе — ниже €5 и только когда SMS настроены", () => {
    const base = { priceCents: 12, senders: { t1: "Giliuta" } };
    const acc = (cents: number) => ({ ...base, owner: parseSmsAccount({ balance_cents: cents }).owner });
    assert.equal(balanceWarning(acc(0)), "Пополните баланс");
    assert.equal(balanceWarning(acc(499)), "Пополните баланс");
    assert.equal(balanceWarning(acc(500)), null);
    assert.equal(balanceWarning(acc(1200)), null);
    assert.equal(balanceWarning({ ...acc(0), senders: {} }), null, "SMS не настроены");
    assert.equal(balanceWarning({ ...base, owner: null }), null, "сотруднику баланс не виден");
  });

  test("деньги волны 13: заморозка, долг, автопополнение, тревоги", () => {
    const frozen = parseSmsAccount({ frozen: true, balance_cents: 500, price_cents: 12 });
    assert.equal(frozen.frozen, true);
    assert.equal(balanceWarning(frozen), FROZEN_WORDS, "заморозка видна и без имён отправителя");
    const debt = parseSmsAccount({ balance_cents: -500, price_cents: 12 });
    assert.equal(balanceWarning(debt), "Долг по балансу — SMS не уходят");
    assert.equal(balanceWords(-500, 0, 12), "долг €5");

    const noCard = parseSmsAccount({ balance_cents: 0, autotopup: { enabled: true, card: null } });
    assert.equal(noCard.owner?.autotopup?.enabled, false, "без карты автопополнение не включено");
    const auto = parseSmsAccount({
      balance_cents: 0,
      autotopup: { enabled: true, threshold_cents: 1000, amount_cents: 5000, card: "Visa •••• 4242", error: null },
      alerts: [
        { kind: "dispute", message: "Спор по оплате", at: "2026-09-30T10:00:00Z", own: true },
        { kind: "platform_cap", message: "Пауза", at: "2026-09-30T10:01:00Z", own: null },
        { kind: "empty", message: "" },
      ],
    });
    assert.deepEqual(auto.owner?.autotopup, {
      enabled: true,
      thresholdCents: 1000,
      amountCents: 5000,
      card: "Visa •••• 4242",
      error: null,
    });
    assert.deepEqual(auto.owner?.alerts?.map((a) => [a.kind, a.own]), [["dispute", true], ["platform_cap", false]]);
    assert.equal(parseSmsAccount({ frozen: false }).owner, null, "сотруднику ни денег, ни тревог");
    assert.equal(smsErrorText(new Error("sms:frozen")), FROZEN_WORDS);
    assert.equal(smsErrorText(new Error("sms:autotopup_card")), "Сначала сохраните карту — оплатой с автопополнением");
  });

  test("оплата не открылась — словами, без «Edge Function returned…»", () => {
    assert.equal(checkoutErrorText("stripe_failed"), "Оплата сейчас недоступна — попробуйте позже");
    assert.equal(checkoutErrorText("stripe_not_configured"), "Оплата сейчас недоступна — попробуйте позже");
    assert.equal(checkoutErrorText("owner_only"), "Пополнять баланс может только владелец");
    assert.equal(checkoutErrorText("bad_amount"), "Такой суммы нет");
    assert.equal(checkoutErrorText(null, true), "Нет связи — проверьте интернет");
    assert.equal(checkoutErrorText(undefined), "Попробуйте ещё раз");
  });

  test("отказы базы — словами", () => {
    assert.equal(smsErrorText(new Error("sms:funds")), "Не хватает баланса SMS");
    assert.equal(smsErrorText(new Error("sms:opt_out")), "Клиент просил не присылать SMS");
    assert.equal(smsErrorText(new Error("что-то")), "что-то");
  });
});
