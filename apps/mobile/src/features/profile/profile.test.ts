import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { phoneToSave, profileFromMetadata } from "./profile";

describe("profileFromMetadata", () => {
  test("имя, телефон и отметка подтверждения из метаданных", () => {
    assert.deepEqual(
      profileFromMetadata({ full_name: " Dmitry ", phone: "+35799123456", phone_verified: false }),
      { name: "Dmitry", phone: "+35799123456", phoneVerified: false },
    );
  });

  test("старый аккаунт без имени и мусор вместо метаданных", () => {
    assert.deepEqual(profileFromMetadata({}), { name: "", phone: "", phoneVerified: false });
    assert.deepEqual(profileFromMetadata(null), { name: "", phone: "", phoneVerified: false });
    assert.deepEqual(profileFromMetadata([]), { name: "", phone: "", phoneVerified: false });
    assert.deepEqual(profileFromMetadata({ full_name: 42, phone_verified: "true" }), {
      name: "",
      phone: "",
      phoneVerified: false,
    });
  });
});

describe("phoneToSave", () => {
  test("пусто или один код страны — номер снимается", () => {
    assert.equal(phoneToSave(""), null);
    assert.equal(phoneToSave("   "), null);
    assert.equal(phoneToSave("+357 "), null);
  });

  test("настоящий номер уходит в E.164, в том числе без кода страны", () => {
    assert.equal(phoneToSave("+357 99 123456"), "+35799123456");
    assert.equal(phoneToSave("99123456"), "+35799123456");
  });

  test("без единой цифры — как пусто: номер снимается", () => {
    // Поле номера букв не пропускает (`sanitizePhoneInput`), но разбор не должен
    // превращать «ничего» в ошибку.
    assert.equal(phoneToSave("abc"), null);
  });

  test("цифры, из которых номер не собрать, не сохраняются", () => {
    assert.equal(phoneToSave("12"), undefined);
    assert.equal(phoneToSave("+357 12"), undefined);
  });
});
