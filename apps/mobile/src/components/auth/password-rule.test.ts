import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { passwordAccepted, passwordHint, passwordTooSimple } from "./password-rule";

describe("password-rule", () => {
  test("нелепые наборы отсекаются", () => {
    for (const p of [
      "123456",
      "1234567890",
      "654321",
      "0987654321",
      "111111",
      "aaaaaaaa",
      "121212",
      "123123",
      "abcdef",
      "qwerty",
      "QWERTY",
      "йцукен",
      "password",
      "Пароль",
      "1q2w3e4r",
    ]) {
      assert.equal(passwordTooSimple(p), true, p);
      assert.equal(passwordAccepted(p), false, p);
    }
  });

  test("лёгкие, но осмысленные пароли проходят", () => {
    for (const p of ["artem1", "kot2024", "solnce", "qwerty7", "135790", "masha99", "лимон12"]) {
      assert.equal(passwordTooSimple(p), false, p);
      assert.equal(passwordAccepted(p), true, p);
    }
  });

  test("подсказка: сперва длина, потом простота", () => {
    assert.equal(passwordHint(""), null);
    assert.equal(passwordHint("1234"), "Минимум 6 символов");
    assert.equal(passwordHint("123456"), "Слишком простой пароль — как 123456 или 111111");
    assert.equal(passwordHint("artem1"), null);
  });
});
