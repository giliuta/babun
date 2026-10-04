import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { APP_STORE_IDS } from "@babun/shared/i18n/locale";

// ЯЗЫК ДО ВХОДА (владелец 04.10: «не все говорят на русском… как он зайдёт,
// увидит русский — как он зарегистрируется»). Первый запуск говорит на языке
// телефона или браузера, экраны входа дают его сменить, регистрация его
// запоминает. Прежняя установка остаётся русской — её узнают по хранилищу.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("язык до входа", () => {
  test("у каждого экрана входа — кнопка языка, выбор перезапускает приложение", () => {
    const card = read("AuthCard.tsx");
    assert.match(card, /<AuthLanguageButton \/>/);
    const button = read("AuthLanguageButton.tsx");
    assert.match(button, /<LanguageOptionList\s+selected=\{current\.code\}/);
    assert.match(button, /if \(code !== current\.code && saveUiLocale\(code\)\) reloadApp\(\);/);
  });

  test("регистрация запоминает язык — письма человеку на нём же", () => {
    assert.match(read("../../../app/(auth)/register.tsx"), /locale: uiLocale\(\),/);
  });

  test("язык запуска решается до первого обращения к хранилищу", () => {
    const boot = read("../../bootstrap.ts");
    const decide = boot.indexOf("\nuiLocale();");
    assert.ok(decide > 0, "bootstrap не спрашивает язык");
    assert.ok(decide < boot.indexOf("setStorage("), "язык спрашивают после того, как хранилище подключено");
  });

  test("прежнюю установку узнают по тем же хранилищам, что открывает приложение", () => {
    const mmkv = read("../../storage/mmkv.ts");
    for (const id of APP_STORE_IDS) assert.match(mmkv, new RegExp(`_ID = "${id}";`), id);
  });

  // ШТОРКА ЯЗЫКОВ НА ВЕБЕ (04.10): высота окна, взятая константой при загрузке
  // модуля, в браузере бывала 0 — лист схлопывался, строки уходили под край.
  test("нижний лист берёт высоту окна при показе, а не при загрузке модуля", () => {
    const sheet = read("../ui/BottomSheet.tsx");
    assert.doesNotMatch(sheet, /Dimensions\.get\("window"\)/);
    assert.match(sheet, /const \{ height: SCREEN_H \} = useWindowDimensions\(\);/);
  });
});
