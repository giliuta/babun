import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ВЫПУСК В МАГАЗИНЫ 06.10 — ЧТО ВИДИТ ПРОВЕРКА APP STORE. Экраны тянут
// react-native, поэтому сторожим исходник: каждая проверка держит правку,
// без которой проверяющий видел бы недоделку или неправду.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("импорт из контактов телефона", () => {
  const sheet = () => read("../features/clients/import/ContactsImportSheet.tsx");

  test("лист открывается без единой галки — «выбрать всё» при открытии нет", () => {
    const src = sheet();
    assert.match(src, /setRows\(list\);\s*(?:\/\/[^\n]*\n\s*)*setPicked\(new Set\(\)\);/);
    assert.doesNotMatch(src, /setPicked\(new Set\(list/);
  });

  test("текст не обещает «ничего не отправляет»: отмеченные уходят в клиенты", () => {
    const src = sheet();
    assert.doesNotMatch(src, /ничего не отправляет/);
    assert.match(
      src,
      /Babun читает контакты только когда вы открываете этот список и добавляет в клиенты только отмеченных\./,
    );
  });

  test("«Добавить N» — в футере листа, над полосой home-индикатора", () => {
    const src = sheet();
    assert.match(src, /footer=\{\s*<View[^>]*>\s*<Pressable\s+onPress=\{\(\) => void run\(\)\}/);
  });
});

describe("заглушек «Скоро» нет", () => {
  test("форма услуги — без строки «Онлайн-запись · Скоро»", () => {
    const src = read("../features/services/ServiceSheet.tsx");
    assert.doesNotMatch(src, /^\s*Онлайн-запись\s*$/m);
    assert.doesNotMatch(src, /^\s*Скоро\s*$/m);
  });

  test("документы клиента — без строки «Договоры · Скоро»", () => {
    const src = read("../../app/documents/index.tsx");
    assert.doesNotMatch(src, /label="Договоры"/);
    assert.doesNotMatch(src, /placeholder="Скоро"/);
  });
});

describe("«О приложении»", () => {
  test("обновление — показание: ни проверки, ни загрузки, ни перезапуска по кнопке", () => {
    const src = read("../features/cabinet/AboutScreen.tsx");
    assert.doesNotMatch(src, /checkForUpdateAsync|fetchUpdateAsync|reloadAsync/);
    assert.doesNotMatch(src, /onPress=/);
  });

  test("версия на телефоне — версия магазина, внутренняя только на сайте", () => {
    const facts = read("../features/cabinet/app-facts.ts");
    assert.match(facts, /web: Platform\.OS === "web",\s*storeVersion: Constants\.expoConfig\?\.version,/);
    const help = read("../features/cabinet/HelpScreen.tsx");
    assert.doesNotMatch(help, /DISPLAY_VERSION/);
    assert.match(help, /supportLink\(row, versionSummary\(appBuildFacts\(\)\)\)/);
  });
});
