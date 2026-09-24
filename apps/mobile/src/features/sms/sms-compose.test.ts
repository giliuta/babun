import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SmsTemplate } from "@babun/shared/local/sms-templates";
import { fillTemplate, smsOptions, smsUrlWithBody, smsVars } from "./sms-compose";

const tpl = (id: string, body: string, enabled = true): SmsTemplate => ({
  id,
  kind: "reminder",
  name: id,
  body,
  enabled,
});

const RECORD = smsVars({
  name: "Мария",
  date: "2026-09-24",
  time: "09:05:00",
  calendar: "Бригада 1",
  services: ["Чистка", "Заправка", "Чистка"],
  address: "Пафос, Tombs of the Kings 12",
  total: 80,
  company: "Giliuta",
  currency: "EUR",
});

describe("поля шаблона из записи", () => {
  test("день, дата и время — как их пишут людям", () => {
    assert.equal(RECORD.Day, "четверг");
    assert.equal(RECORD.Date, "24 сентября");
    assert.equal(RECORD.Time, "09:05");
  });

  test("услуги без повторов, цена в валюте компании", () => {
    assert.equal(RECORD.Service, "Чистка, Заправка");
    assert.equal(RECORD.Price, "€80");
  });

  test("пустое и нулевое в словарь не попадает", () => {
    const vars = smsVars({ name: "  ", total: 0, debt: 0, address: "", services: ["", null] });
    assert.deepEqual(vars, {});
  });
});

describe("шаблон заполняется целиком или не показывается", () => {
  test("русские и английские токены подставляются одинаково", () => {
    assert.equal(
      fillTemplate("[Имя], ждём вас [Дата] в [Time]. [Компания]", RECORD),
      "Мария, ждём вас 24 сентября в 09:05. Giliuta",
    );
  });

  test("карточка без записи: шаблон с датой не заполняется", () => {
    const client = smsVars({ name: "Мария", company: "Giliuta" });
    assert.equal(fillTemplate("[Имя], ждём вас [Дата]", client), null);
    assert.equal(fillTemplate("[Имя], спасибо! [Компания]", client), "Мария, спасибо! Giliuta");
  });

  test("незнакомый токен шаблон не пропускает — клиент не увидит скобок", () => {
    assert.equal(fillTemplate("[Имя], ссылка: [СсылкаНаОтмену]", RECORD), null);
  });

  test("пустой шаблон отправлять нечего", () => {
    assert.equal(fillTemplate("   ", RECORD), null);
  });

  test("список: выключенные и незаполняемые уходят, порядок компании сохраняется", () => {
    const options = smsOptions(
      [
        tpl("a", "[Имя], долг [Сумма]"),
        tpl("b", "[Имя], до встречи [Дата]"),
        tpl("c", "[Имя], привет", false),
        tpl("d", "[Компания]: [Имя], спасибо"),
      ],
      RECORD,
    );
    assert.deepEqual(
      options.map((o) => [o.template.id, o.text]),
      [
        ["b", "Мария, до встречи 24 сентября"],
        ["d", "Giliuta: Мария, спасибо"],
      ],
    );
  });
});

describe("ссылка на «Сообщения»", () => {
  test("iOS — &body=, Android — ?body=, текст закодирован", () => {
    assert.equal(smsUrlWithBody("sms:+35799123456", "Да & нет", "ios"), "sms:+35799123456&body=%D0%94%D0%B0%20%26%20%D0%BD%D0%B5%D1%82");
    assert.equal(smsUrlWithBody("sms:+35799123456", "ok", "android"), "sms:+35799123456?body=ok");
  });

  test("без текста — голая ссылка", () => {
    assert.equal(smsUrlWithBody("sms:+35799123456", "", "ios"), "sms:+35799123456");
  });
});
