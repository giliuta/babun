import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countryDialCode, normalizeCountry, tryToE164 } from "./phone";

// КОД СТРАНЫ КОМПАНИИ — подстановка, а не ограничение.
//
// Владелец 2026-07-26: «код страны надо, чтобы он был сразу автоматически, и в
// настройках можно было сразу выбирать… а если работать по разным странам —
// надо это продумать». Настройка задаёт, с чего открывается пустое поле и как
// понимать номер БЕЗ «+». Номер СО «+» всегда уважается как есть, поэтому
// работа по нескольким странам не требует переключать настройку.

describe("код страны компании", () => {
  test("неизвестное значение не ломает продукт — Кипр по умолчанию", () => {
    assert.equal(normalizeCountry(null), "CY");
    assert.equal(normalizeCountry(""), "CY");
    assert.equal(normalizeCountry("Кипр"), "CY");
    assert.equal(normalizeCountry("ZZ"), "CY");
  });

  test("код читается регистронезависимо", () => {
    assert.equal(normalizeCountry("gr"), "GR");
    assert.equal(normalizeCountry(" DE "), "DE");
  });

  test("из кода выводится и «+» для поля ввода", () => {
    assert.equal(countryDialCode(normalizeCountry("GR")), "+30");
    assert.equal(countryDialCode(normalizeCountry("CY")), "+357");
  });

  test("местный номер без «+» разбирается кодом СВОЕЙ страны", () => {
    // Один и тот же набор цифр — разные страны, разные ключи дедупа.
    assert.equal(tryToE164("99123456", "CY"), "+35799123456");
    assert.equal(tryToE164("6912345678", "GR"), "+306912345678");
  });

  test("номер со своим «+» настройка НЕ переписывает", () => {
    // Кипрская фирма заводит греческого клиента — ничего не переключая.
    assert.equal(tryToE164("+306912345678", "CY"), "+306912345678");
    assert.equal(tryToE164("+35799123456", "GR"), "+35799123456");
  });
});
