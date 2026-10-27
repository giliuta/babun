import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acceptSmsInput,
  fillTemplate,
  fitsSmsLimit,
  MAX_SMS_PARTS,
  smsLanguageOf,
  smsPartsOf,
  smsUrlWithBody,
  smsVars,
  stripEmoji,
} from "./sms-compose";

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

describe("день и дата — на языке шаблона", () => {
  test("английский шаблон не получает русских слов", () => {
    assert.equal(
      fillTemplate("Hi [Name], see you on [Day], [Date] at [Time]. [Company]", RECORD),
      "Hi Мария, see you on Thursday, 24 September at 09:05. Giliuta",
    );
  });

  test("каждый язык интерфейса пишет день и дату своими словами", () => {
    const cases: [string, string][] = [
      ["[Имя], ждём вас: [День], [Дата]", "Мария, ждём вас: четверг, 24 сентября"],
      ["[Name], σας περιμένουμε: [Day], [Date]", "Мария, σας περιμένουμε: Πέμπτη, 24 Σεπτεμβρίου"],
      ["[Имя]: чекаємо вас у [День], [Дата]", "Мария: чекаємо вас у четвер, 24 вересня"],
      ["Здравейте, [Имя]! Очакваме Ви: [День], [Дата]", "Здравейте, Мария! Очакваме Ви: четвъртък, 24 септември"],
      ["Hallo [Name], wir kommen am [Day], [Date]", "Hallo Мария, wir kommen am Donnerstag, 24. September"],
      ["Hola [Name], te esperamos el [Day], [Date]", "Hola Мария, te esperamos el jueves, 24 de septiembre"],
    ];
    for (const [body, text] of cases) assert.equal(fillTemplate(body, RECORD), text, body);
  });

  test("язык читается по тексту, а не по полям", () => {
    assert.equal(smsLanguageOf("[Имя], [Дата] [Время]"), "ru", "одни поля — русский, как раньше");
    assert.equal(smsLanguageOf("[Имя], see you [Дата]"), "en");
    assert.equal(smsLanguageOf("Thank you for your booking, see you on [Day] at the office"), "en");
    assert.equal(smsLanguageOf("Wir sehen uns am [Day]"), "de");
    assert.equal(smsLanguageOf("Nos vemos el [Day]"), "es");
    assert.equal(smsLanguageOf("Напоминаем: завтра в [Время]"), "ru");
    assert.equal(smsLanguageOf("Ще ви чакаме утре"), "bg");
    assert.equal(smsLanguageOf("Чекаємо на вас"), "uk");
    assert.equal(smsLanguageOf(""), "ru");
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

describe("лимит сообщения и без эмодзи (владелец 30.09)", () => {
  test("эмодзи в поле не попадают", () => {
    assert.equal(stripEmoji("Ждём вас 😀👍 завтра ☀️"), "Ждём вас  завтра ");
    assert.equal(acceptSmsInput("Привет 😀", "Привет "), "Привет ");
  });

  test("до 3 SMS — пишется, сверх — прежний текст; стирать можно всегда", () => {
    const at201 = "я".repeat(201);
    assert.equal(smsPartsOf(at201), MAX_SMS_PARTS);
    assert.equal(acceptSmsInput(at201, "я".repeat(200)), at201);
    assert.equal(acceptSmsInput(at201 + "я", at201), at201, "202-й знак не встаёт");
    const over = "я".repeat(250);
    assert.equal(acceptSmsInput("я".repeat(249), over), "я".repeat(249), "лишнее стирается");
    assert.equal(smsPartsOf("я".repeat(70)), 1);
    assert.equal(smsPartsOf("я".repeat(134)), 2);
  });

  test("длиннее 3 SMS не отправляется: стёртый наполовину текст тоже", () => {
    // Поле пускает стирание сверх предела, поэтому текст длиннее 3 SMS
    // может в нём стоять — отправка его гасит, а не уносит на сервер.
    assert.equal(fitsSmsLimit("я".repeat(201)), true);
    assert.equal(fitsSmsLimit("я".repeat(202)), false);
    assert.equal(fitsSmsLimit(""), false, "пустой — нечего отправлять");
  });

  test("шаблон меряется с подставленными полями", () => {
    const measure = (x: string) => x.replace("[Имя]", "Александра");
    const base = "я".repeat(195);
    assert.equal(acceptSmsInput(base + "[Имя]", base, measure), base, "с именем вышло бы 205 знаков");
  });
});
