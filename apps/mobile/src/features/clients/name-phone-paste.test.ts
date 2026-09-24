import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { splitNameAndPhone } from "./name-phone-paste";

describe("splitNameAndPhone — вставка «имя + номер» в поле имени", () => {
  test("контакт из WhatsApp: имя остаётся, номер уходит в телефон", () => {
    assert.deepEqual(splitNameAndPhone("Мария Спиру +357 99 123456", "CY"), {
      name: "Мария Спиру",
      phone: "+357 99 123456",
      e164: "+35799123456",
    });
  });

  test("невидимые знаки направления WhatsApp не попадают в имя", () => {
    const split = splitNameAndPhone("Мария ‪+357 99 123456‬", "CY");
    assert.equal(split?.name, "Мария");
    assert.equal(split?.e164, "+35799123456");
  });

  test("номер впереди и разделитель между ними", () => {
    assert.equal(splitNameAndPhone("+357 99 123456 – Мария", "CY")?.name, "Мария");
    assert.equal(splitNameAndPhone("Мария, +357 99-123-456", "CY")?.name, "Мария");
  });

  test("номер без «+» разбирается кодом страны компании", () => {
    assert.equal(splitNameAndPhone("Andreas 99123456", "CY")?.e164, "+35799123456");
    assert.equal(splitNameAndPhone("Nikos 6912345678", "GR")?.e164, "+306912345678");
  });

  test("номера нет — ничего не делаем", () => {
    assert.equal(splitNameAndPhone("Мария Спиру", "CY"), null);
    assert.equal(splitNameAndPhone("Вилла 12", "CY"), null);
    // Похоже на номер, но не разбирается (у кипрского номера восемь цифр).
    assert.equal(splitNameAndPhone("Заказ 1234567", "CY"), null);
  });

  test("один номер без имени — не трогаем (имя не стираем в ноль)", () => {
    assert.equal(splitNameAndPhone("+357 99 123456", "CY"), null);
  });

  test("два номера — не угадываем, чей какой", () => {
    assert.equal(splitNameAndPhone("Мария +357 99 123456, Павел +357 97 654321", "CY"), null);
  });
});
