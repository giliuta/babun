import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBlankClient } from "@babun/shared/local/clients";
import {
  buildCallerIdEntries,
  compareE164Digits,
  serializeCallerIdEntries,
} from "./caller-id-entries";

// CallKit отвергает ВЕСЬ список, если номера не по возрастанию или
// повторяются, — тогда не подписывается ни один звонок. Поэтому порядок и
// уникальность проверяются здесь, а не на телефоне.

const andreas = createBlankClient({
  id: "c1",
  full_name: "Andreas Georgiou",
  phone: "99 123 456",
  city: "Limassol",
});
andreas.phone_e164 = "+35799123456";

describe("список определителя номера", () => {
  test("основной номер — цифры E.164 без «+», подпись с городом и Babun", () => {
    assert.deepEqual(buildCallerIdEntries([andreas]), [
      { number: "35799123456", label: "Andreas Georgiou · Limassol · Babun" },
    ]);
  });

  test("номер без E.164 дополняется кодом страны по умолчанию", () => {
    const maria = createBlankClient({ id: "c2", full_name: "Maria", phone: "96 000 001" });
    assert.deepEqual(buildCallerIdEntries([maria], "CY"), [
      { number: "35796000001", label: "Maria · Babun" },
    ]);
  });

  test("номера строго по возрастанию числом, а не строкой", () => {
    const uk = createBlankClient({ id: "a", full_name: "Tom", phone: "+44 7911 123456" });
    const us = createBlankClient({ id: "b", full_name: "Joe", phone: "+1 202 555 0143" });
    const cy = createBlankClient({ id: "c", full_name: "Eleni", phone: "+357 99 000 002" });
    const numbers = buildCallerIdEntries([cy, uk, us]).map((entry) => entry.number);
    assert.deepEqual(numbers, ["12025550143", "35799000002", "447911123456"]);
    for (let i = 1; i < numbers.length; i += 1) {
      assert.ok(BigInt(numbers[i - 1]) < BigInt(numbers[i]));
    }
  });

  test("один номер у двух карточек — одна запись, имя первой по алфавиту", () => {
    const husband = createBlankClient({ id: "h", full_name: "Pavel", phone: "+35799111222" });
    const wife = createBlankClient({ id: "w", full_name: "Ekaterina", phone: "+357 99 111 222" });
    assert.deepEqual(buildCallerIdEntries([husband, wife]), [
      { number: "35799111222", label: "Ekaterina · Babun" },
    ]);
  });

  test("дополнительный номер подписан своим именем и берёт страну основного", () => {
    const client = createBlankClient({ id: "g", full_name: "Nikos", phone: "+44 7911 123111" });
    client.phones = [{ id: "p1", number: "7911 123222", label: "Жена", name: "Anna" }];
    assert.deepEqual(buildCallerIdEntries([client], "CY"), [
      { number: "447911123111", label: "Nikos · Babun" },
      { number: "447911123222", label: "Anna · Nikos · Babun" },
    ]);
  });

  test("корзина, пустое имя и неразборчивый номер не попадают", () => {
    const trashed = createBlankClient({ id: "t", full_name: "Old", phone: "+35799000003" });
    trashed.deleted_at = "2026-10-01T00:00:00Z";
    const noName = createBlankClient({ id: "n", full_name: "  ", phone: "+35799000004" });
    const junk = createBlankClient({ id: "j", full_name: "Junk", phone: "12" });
    const instagramOnly = createBlankClient({ id: "i", full_name: "Insta", phone: "" });
    assert.deepEqual(buildCallerIdEntries([trashed, noName, junk, instagramOnly]), []);
  });

  test("длинное имя отрезается, а Babun остаётся", () => {
    const long = createBlankClient({
      id: "l",
      full_name: "Konstantinos Papadopoulos-Christodoulides Holdings Ltd",
      phone: "+35799000005",
      city: "Paphos",
    });
    const [entry] = buildCallerIdEntries([long]);
    assert.ok(entry.label.length <= 48);
    assert.ok(entry.label.endsWith(" · Babun"));
    assert.ok(entry.label.startsWith("Konstantinos"));
  });

  test("файл расширения — строка на номер, табуляция в имени не рвёт запись", () => {
    const text = serializeCallerIdEntries([
      { number: "35799000006", label: "A\tB · Babun" },
      { number: "35799000007", label: "C\nD · Babun" },
    ]);
    assert.equal(text, "35799000006\tA B · Babun\n35799000007\tC D · Babun");
  });

  test("сравнение цифр — числовое", () => {
    assert.ok(compareE164Digits("9", "10") < 0);
    assert.ok(compareE164Digits("357", "356") > 0);
    assert.equal(compareE164Digits("44", "44"), 0);
  });
});
