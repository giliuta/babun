import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HELP_FAQ,
  SUPPORT_CONTACTS,
  emailLink,
  supportLink,
  supportMailBody,
  supportRows,
  telegramLink,
  whatsappLink,
} from "./help";

describe("whatsappLink", () => {
  test("в ссылку идут одни цифры", () => {
    assert.equal(whatsappLink("+357 99 123-456"), "https://wa.me/35799123456");
    assert.equal(whatsappLink("(+44) 7700 900 123"), "https://wa.me/447700900123");
  });
});

describe("telegramLink", () => {
  test("«@» в начале не попадает в ссылку", () => {
    assert.equal(telegramLink("@babun_support"), "https://t.me/babun_support");
    assert.equal(telegramLink("babun_support"), "https://t.me/babun_support");
    assert.equal(telegramLink("  @babun_support "), "https://t.me/babun_support");
  });
});

describe("emailLink", () => {
  const link = emailLink(" help@babun.app ", "v1.8.33");

  test("адрес как есть, без пробелов по краям", () => {
    assert.ok(link.startsWith("mailto:help@babun.app?"));
  });

  test("тема и тело закодированы, переводы строк — %0A", () => {
    const query = new URLSearchParams(link.slice(link.indexOf("?") + 1));
    assert.equal(query.get("subject"), "Вопрос по Babun");
    assert.equal(query.get("body"), supportMailBody("v1.8.33"));
    assert.ok(!link.includes("\n"));
    assert.ok(!link.includes(" "));
    assert.ok(link.includes("%0A"));
  });

  test("в тело письма встают версия, устройство и пустая строка под вопрос", () => {
    assert.equal(
      supportMailBody("v1.8.33"),
      "Версия приложения: v1.8.33\nУстройство: iPhone\n\n",
    );
  });
});

describe("supportRows", () => {
  test("в продукте — только почта, названная владельцем 04.10; пустые каналы строк не дают", () => {
    assert.deepEqual(
      supportRows(SUPPORT_CONTACTS).map((row) => row.sub),
      ["babun.app@gmail.com"],
    );
    assert.deepEqual(supportRows({ whatsapp: " ", telegram: " @ ", email: "  " }), []);
  });

  test("в раздел идут только заполненные каналы, в порядке WhatsApp · Telegram · Почта", () => {
    const rows = supportRows({
      whatsapp: "+357 99 123 456",
      telegram: "",
      email: "help@babun.app",
    });
    assert.deepEqual(
      rows.map((row) => row.channel),
      ["whatsapp", "email"],
    );
    assert.deepEqual(
      supportRows({ whatsapp: "", telegram: "@babun_support", email: "" }).map(
        (row) => row.sub,
      ),
      ["@babun_support"],
    );
  });

  test("номер без цифр не даёт строку: ссылка вела бы в пустоту", () => {
    assert.deepEqual(supportRows({ whatsapp: "позвоните", telegram: "", email: "" }), []);
  });

  test("ссылка строки собирается по её каналу", () => {
    const [whatsapp, telegram, email] = supportRows({
      whatsapp: "+357 99 123 456",
      telegram: "@babun_support",
      email: "help@babun.app",
    });
    assert.equal(supportLink(whatsapp, "v1"), "https://wa.me/35799123456");
    assert.equal(supportLink(telegram, "v1"), "https://t.me/babun_support");
    assert.equal(supportLink(email, "v1"), emailLink("help@babun.app", "v1"));
  });
});

describe("HELP_FAQ", () => {
  test("идентификаторы уникальны", () => {
    const ids = HELP_FAQ.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("у каждого пункта есть вопрос и ответ", () => {
    assert.ok(HELP_FAQ.length > 0);
    for (const item of HELP_FAQ) {
      assert.ok(item.id.trim().length > 0, "id");
      assert.ok(item.question.trim().length > 0, `вопрос ${item.id}`);
      assert.ok(item.answer.trim().length > 0, `ответ ${item.id}`);
    }
  });

  test("вопросы не повторяются", () => {
    const questions = HELP_FAQ.map((item) => item.question);
    assert.equal(new Set(questions).size, questions.length);
  });
});
