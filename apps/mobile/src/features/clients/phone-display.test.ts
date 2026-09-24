import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  composePhone,
  formatPhoneForDisplay,
  nationalPart,
  phoneCountryOf,
  tryToE164,
} from "./phone";

// НОМЕР И КНОПКА СВЯЗИ (владелец 22.09: «как правильно писать номер»,
// «звоночек справа должен открывать, как я хочу связаться»).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("номер для глаз", () => {
  test("своя страна — без кода, как диктуют", () => {
    assert.equal(formatPhoneForDisplay("+35799000101", "CY"), "99 000101");
    assert.equal(formatPhoneForDisplay("99000101", "CY"), "99 000101");
  });
  test("чужая страна — с «+кодом»", () => {
    assert.equal(formatPhoneForDisplay("+79161234567", "CY"), "+7 916 123 45 67");
    assert.equal(formatPhoneForDisplay("+447700900123", "CY"), "+44 7700 900123");
  });
  test("неразбираемое и пустое — как ввели", () => {
    assert.equal(formatPhoneForDisplay("123", "CY"), "123");
    assert.equal(formatPhoneForDisplay("", "CY"), "");
  });
});

describe("кнопка связи у номера", () => {
  const button = () => read("PhoneChannelButton.tsx");
  test("тап — лист «Связаться», удержание — звонок", () => {
    assert.match(button(), /onPress=\{single \? dial : openChannels\}/);
    assert.match(button(), /onLongPress=\{single \? undefined : dial\}/);
  });
  test("один способ — сразу звонок, без листа из одной строки", () => {
    assert.match(button(), /const single = channels\.length === 1;/);
  });
  test("заголовок листа — номер для глаз, а не сырой из базы", () => {
    assert.match(button(), /title=\{formatPhoneForDisplay\(number, country\)\}/);
  });
});

describe("ввод номера: страна подписью, цифры в поле", () => {
  test("страна узнаётся по набранному коду", () => {
    assert.equal(phoneCountryOf("+35799887766", "CY"), "CY");
    assert.equal(phoneCountryOf("+79161234567", "CY"), "RU");
    assert.equal(phoneCountryOf("+447700900123", "CY"), "GB");
    assert.equal(phoneCountryOf("99887766", "CY"), "CY");
  });
  test("поле держит цифры без кода, в данные — полный номер", () => {
    assert.equal(nationalPart("+357 99887766", "CY"), "99 887766");
    assert.equal(composePhone("99 887766", "CY"), "+357 99 887766");
    assert.equal(tryToE164(composePhone("916 123 45 67", "RU"), "CY"), "+79161234567");
    assert.equal(composePhone("", "CY"), "");
    assert.equal(composePhone("+7 916", "CY"), "+7 916");
  });
  test("номер нового клиента набирается с выбором страны", () => {
    const header = read("ClientHeader.tsx");
    assert.match(header, /label=\{draft \? dial\.label/);
    assert.match(header, /onLabelPress=\{draft \? dial\.openPicker : undefined\}/);
    assert.match(header, /dial\.onType\(v\)/);
  });
});

describe("шторка кода страны", () => {
  test("ищет по названию и по коду", () => {
    const hook = read("use-phone-country.tsx");
    assert.match(hook, /<SelectSearch/);
    assert.match(hook, /name\.includes\(needle\) \|\| countryDialCode\(code\)\.slice\(1\)\.startsWith\(needle\)/);
  });
});
