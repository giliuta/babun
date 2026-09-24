import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { money } from "@babun/shared/common/utils/money";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { analyzeSmsEncoding as serverEncoding } from "../../../../../supabase/functions/send_sms/encoding";
import { formatMoney, renderSms } from "../../../../../supabase/functions/send_sms/render";
import { fillTemplate, smsVars } from "./sms-compose";

// СЕРВЕР ОБЯЗАН ПИСАТЬ КЛИЕНТУ ТО ЖЕ, ЧТО ВЛАДЕЛЕЦ ВИДИТ В ЛИСТЕ «SMS»
// (STORY-089). Функция `send_sms` не может импортировать общий код — её
// правила подстановки и счёт частей лежат копией рядом с ней. Этот тест
// держит копию честной: одни и те же записи — один и тот же текст, одни и те
// же части (за части списываются деньги).

const TEMPLATES = [
  "[Имя], запись подтверждена: [Дата], [Время]. Мастер — [Мастер]. Адрес: [Адрес]. — [Компания]",
  "[Имя], напоминаем: [День], [Дата] в [Время] — [Услуга]. [Компания]",
  "[Name], total [Price]. [Company]",
  "[Имя], за вами [Сумма]",
  "[Имя], спасибо!",
  "Без полей вовсе",
  "[Имя], ссылка [СсылкаНаОтмену]",
  "   ",
];

const RECORDS = [
  {
    name: "Мария",
    date: "2026-09-24",
    time: "09:05:00",
    calendar: "Бригада 1",
    services: ["Чистка", "Заправка", "Чистка"],
    address: "  Пафос,   Tombs of the Kings 12 ",
    total: 1234.5,
    debt: 40,
    company: "Giliuta",
    currency: "EUR",
  },
  { name: "Ппк", date: "2026-09-27", time: "13:30", calendar: "Команда 1", services: [], address: "", total: 200, company: "Giliuta", currency: "EUR" },
  { name: "", date: null, time: null, calendar: null, services: null, address: null, total: 0, company: "X", currency: "USD" },
  { name: "Olga", date: "2026-02-28", time: "7:00", calendar: "Crew", services: ["A/C"], address: "Nicosia", total: 99.99, debt: 1000000, company: "Co", currency: "GBP" },
];

describe("текст SMS на сервере = текст в приложении", () => {
  for (const [i, record] of RECORDS.entries()) {
    for (const template of TEMPLATES) {
      test(`запись ${i + 1}: «${template.slice(0, 32)}»`, () => {
        const app = fillTemplate(template, smsVars({ ...record, services: record.services ?? [] }));
        const server = renderSms(template, record);
        assert.equal(server, app);
      });
    }
  }
});

describe("деньги и части — те же", () => {
  test("суммы печатаются как в приложении", () => {
    for (const currency of ["EUR", "USD", "GBP", "UAH", "RUB"]) {
      for (const value of [0.5, 80, 1234.5, 1_000_000]) {
        assert.equal(formatMoney(value, currency), money(value, currency), `${currency} ${value}`);
      }
    }
  });

  test("части SMS считаются одинаково", () => {
    const samples = [
      "",
      "Hello",
      "a".repeat(160),
      "a".repeat(161),
      "Привет".repeat(12),
      "Привет".repeat(13),
      "Price €10 {x}",
      "Мария, запись подтверждена: 24 сентября, 09:05. Мастер — Бригада 1. Адрес: Пафос. — Giliuta",
    ];
    for (const text of samples) {
      assert.deepEqual(serverEncoding(text), analyzeSmsEncoding(text), text);
    }
  });
});
