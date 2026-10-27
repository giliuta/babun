import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contactRows } from "./contact-rows";

const none = new Set<string>();

describe("контакт телефона → строка импорта", () => {
  test("контакт без номера — тоже строка, по имени", () => {
    const [row] = contactRows([{ id: "c1", name: "Мария вилла" }], "CY", none);
    assert.equal(row.name, "Мария вилла");
    assert.equal(row.phone, "");
    assert.equal(row.phoneE164, null);
    assert.equal(row.key, "contact:c1");
  });

  test("все номера переезжают: первый разобранный — основной", () => {
    const [row] = contactRows(
      [{ id: "c2", name: "Петрос", phoneNumbers: [{ number: "99123456" }, { number: "+357 97 111 222" }] }],
      "CY",
      none,
    );
    assert.equal(row.phoneE164, "+35799123456");
    assert.equal(row.extras.length, 1);
    assert.equal(row.extras[0].label, "Мобильный");
  });

  test("неразобранный номер не становится основным", () => {
    const [row] = contactRows([{ id: "c3", name: "Kate Bell", phoneNumbers: [{ number: "5555648583" }] }], "CY", none);
    assert.equal(row.phone, "");
    assert.equal(row.phoneE164, null);
    assert.deepEqual(row.extras.map((e) => e.number), ["5555648583"]);
  });

  test("«уже есть» — по любому номеру контакта", () => {
    const known = new Set(["35797111222"]);
    const [row] = contactRows(
      [{ id: "c4", name: "Андреас", phoneNumbers: [{ number: "99000777" }, { number: "97111222" }] }],
      "CY",
      known,
    );
    assert.equal(row.exists, true);
  });
});
