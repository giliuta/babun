import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  composePhone,
  formatPhoneAsYouType,
  formatPhoneForDisplay,
  groupCyprusDigits,
  nationalPart,
  phoneCountryOf,
  tryToE164,
} from "./phone";

// НОМЕР И КНОПКА СВЯЗИ (владелец 22.09: «как правильно писать номер»,
// «звоночек справа должен открывать, как я хочу связаться»).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("номер для глаз", () => {
  test("своя страна — тоже с кодом (владелец 01.10: «обязательно код страны»)", () => {
    assert.equal(formatPhoneForDisplay("+35799000101", "CY"), "+357 99 000 101");
    assert.equal(formatPhoneForDisplay("99000101", "CY"), "+357 99 000 101");
    assert.equal(formatPhoneForDisplay("+357 97 469998", "CY"), "+357 97 469 998");
  });
  test("кипрский номер у компании другой страны — с кодом, теми же группами", () => {
    assert.equal(formatPhoneForDisplay("+35799000101", "GB"), "+357 99 000 101");
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
  // 03.10: строка работодателя в общем списке жила в компании экрана — лист
  // читал набор телефона, а шестерёнки не было вовсе.
  test("клиент другой компании — набор и шестерёнка его компании", () => {
    assert.match(
      button(),
      /<ClientsScopeProvider scope=\{source\}>\s*<ChannelButton \{\.\.\.props\} \/>/,
      "кнопка не встаёт в компанию клиента",
    );
    assert.match(read("ClientRow.tsx"), /<PhoneChannelButton[^>]*source=\{source\}/, "строка не передаёт компанию кнопке");
    assert.match(
      read("../../../app/(dashboard)/clients/index.tsx"),
      /<ClientRow[^>]*source=\{guest\}/,
      "список не передаёт строке компанию работодателя",
    );
  });
});

describe("кипрский номер группами 2 · 3 · 3 (аудит 29.09)", () => {
  test("по мере ввода — сколько набрано", () => {
    assert.equal(groupCyprusDigits("9"), "9");
    assert.equal(groupCyprusDigits("9900"), "99 00");
    assert.equal(groupCyprusDigits("99000001"), "99 000 001");
    assert.equal(groupCyprusDigits("990000011"), null);
  });
  test("поле ввода и живой формат", () => {
    assert.equal(nationalPart("99000001", "CY"), "99 000 001");
    assert.equal(formatPhoneAsYouType("99000001", "CY"), "99 000 001");
    assert.equal(formatPhoneAsYouType("+35799000001", "CY"), "+357 99 000 001");
    assert.equal(formatPhoneAsYouType("+79161234567", "CY"), "+7 916 123 45 67");
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
    assert.equal(nationalPart("+357 99887766", "CY"), "99 887 766");
    assert.equal(composePhone("99 887 766", "CY"), "+357 99 887 766");
    assert.equal(tryToE164(composePhone("916 123 45 67", "RU"), "CY"), "+79161234567");
    assert.equal(composePhone("", "CY"), "");
    assert.equal(composePhone("+7 916", "CY"), "+7 916");
  });
  test("номер нового клиента набирается с выбором страны", () => {
    const header = read("ClientHeader.tsx");
    // С 30.09 (вариант 10 владельца) страна — не подписью с флагом, а тихим
    // кодом перед цифрами; тап по коду открывает выбор страны.
    assert.match(header, /:\s*dial\.code/);
    // Тап по коду меняет страну и в новом клиенте, и на карточке (30.09).
    assert.match(header, /onPrefixPress=\{draft \|\| !readOnly \? dial\.openPicker : undefined\}/);
    assert.match(read("ClientExtraContacts.tsx"), /onPrefixPress=\{readOnly \? undefined : \(\) => setCodeFor\(p\)\}/);
    assert.match(header, /dial\.onType\(v\)/);
    assert.doesNotMatch(header, /countryFlag/);
  });
});

describe("шторка кода страны", () => {
  test("ищет по названию и по коду", () => {
    const hook = read("use-phone-country.tsx");
    assert.match(hook, /export function CountryPickerSheet/);
    assert.match(hook, /<SelectSearch/);
    assert.match(hook, /name\.includes\(needle\) \|\| countryDialCode\(code\)\.slice\(1\)\.startsWith\(needle\)/);
  });
});
