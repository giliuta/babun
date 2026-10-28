import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizePhoneInput } from "./phone-input";

describe("ввод номера", () => {
  test("«+», набранный за подставленным кодом, заменяет код", () => {
    assert.equal(sanitizePhoneInput("+357 +44 7911 123456"), "+44 7911 123456");
    assert.equal(sanitizePhoneInput("+357 +"), "+");
  });

  test("обычный набор и вставка — как прежде", () => {
    assert.equal(sanitizePhoneInput("+357 99 123456"), "+357 99 123456");
    assert.equal(sanitizePhoneInput("99 123 456"), "99 123 456");
    assert.equal(sanitizePhoneInput("Тел: +357 99"), "+357 99");
    assert.equal(sanitizePhoneInput("Имя\n+357 99 1"), "+357 99 1");
  });
});
