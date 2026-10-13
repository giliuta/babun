import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatPhoneAsYouType,
  formatPhoneForDisplay,
  groupCyprusDigits,
  tryToE164,
} from "@/lib/phone";
import { withHomeCode } from "./use-phone-country";
import { readModuleSource } from "../../lib/module-source";
import { clientsListSource } from "./list/source-for-tests";

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
    assert.match(button(), /const single = items\.length === 1;/);
  });
  test("заголовок листа — номер для глаз, а не сырой из базы", () => {
    assert.match(button(), /title=\{channels\.length > 0 \? formatPhoneForDisplay\(number, country\)/);
    // Instagram — способ связи и без номера (владелец 12.10).
    assert.match(button(), /instagramDmUrl\(instagramUsername\)/);
    assert.match(button(), /if \(channels\.length === 0 && !instagram\) return null;/);
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
      clientsListSource(),
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
    assert.equal(formatPhoneAsYouType("99000001", "CY"), "99 000 001");
    assert.equal(formatPhoneAsYouType("+35799000001", "CY"), "+357 99 000 001");
    assert.equal(formatPhoneAsYouType("+79161234567", "CY"), "+7 916 123 45 67");
  });
});

describe("код страны — в самом поле (владелец 12.10: «писать код страны, не нужно выбирать»)", () => {
  test("набранное без «+» получает код команды, свой «+» — как есть", () => {
    assert.equal(withHomeCode("99 887 766", "CY"), "+357 99 887 766");
    assert.equal(withHomeCode("+375 29 123 45 67", "CY"), "+375 29 123 45 67");
    assert.equal(withHomeCode("  ", "CY"), "");
    assert.equal(tryToE164(withHomeCode("+375 29 123 45 67", "CY"), "CY"), "+375291234567");
    assert.equal(tryToE164(withHomeCode("916 123 45 67", "RU"), "CY"), "+79161234567");
  });
  test("строки номера без выбора страны: код начинает поле", () => {
    const header = read("ClientHeader.tsx");
    // Entry + parts folder: the messenger rows live in `extra-contacts/`.
    const extras = readModuleSource(resolve(here, "ClientExtraContacts.tsx"), resolve(here, "extra-contacts"));
    for (const src of [header, extras]) {
      assert.doesNotMatch(src, /onPrefixPress|CountryPickerSheet|prefix=\{/);
    }
    assert.match(header, /seed=\{savedPhone\.seed\}/);
    assert.match(header, /onSave=\{draft \? draftPhone\.onType : savedPhone\.onSave\}/);
    assert.match(extras, /seed=\{dialPrefix\(country\)\}/);
    assert.doesNotMatch(read("use-phone-country.tsx"), /CountryPickerSheet/);
    // Один оставленный код номером не считается — строка сохраняется пустой.
    // `card-rows.tsx` is a barrel; the rows live in `card-rows/`.
    const row = readModuleSource(resolve(here, "../../components/ui/card-rows.tsx"));
    assert.match(row, /return seed && typed === seed\.trim\(\) \? "" : typed;/);
  });
});
