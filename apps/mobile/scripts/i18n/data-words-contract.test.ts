import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { transformSync, type PluginItem } from "@babel/core";

// СЛОВА-ДАННЫЕ НЕ ПЕРЕВОДЯТСЯ (03.10, сразу после перевода при сборке).
// Плагин переводит и надписи, и ключи со сравнениями — «с обеих сторон».
// Но у трёх мест другая сторона — ДАННЫЕ, а не код: текст шаблона SMS в базе
// (`[Имя]`), подпись возврата, которую пишет сервер («Возврат при отмене…»),
// и ответ сервера на приглашение. На английском они разошлись: SMS уходила
// с пустыми полями, возврат звался «Оплата снята», кнопка «Войти под другим
// аккаунтом» пропадала. Тест гонит НАСТОЯЩИЕ файлы через плагин.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("./babel-plugin") as PluginItem;
const REPO = path.resolve(__dirname, "../../../..");

function compiled(file: string): string {
  const abs = path.join(REPO, file);
  const out = transformSync(readFileSync(abs, "utf8"), {
    filename: abs,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    generatorOpts: { jsescOption: { minimal: true } },
    plugins: [plugin],
  });
  return out?.code ?? "";
}

describe("i18n: words that are data stay raw", () => {
  it("SMS token aliases keep the Russian keys of the template body", () => {
    const code = compiled("packages/shared/src/local/sms-templates.ts");
    const aliases = code.slice(code.indexOf("const TOKEN_ALIASES"), code.indexOf("};", code.indexOf("const TOKEN_ALIASES")));
    for (const word of ["Имя", "Дата", "Время", "Адрес", "Сумма", "Ссылка"]) {
      assert.ok(aliases.includes(`${word}: "`), `alias key ${word} must stay raw:\n${aliases}`);
    }
    assert.ok(!aliases.includes("__i18n_t"), `aliases must not be translated:\n${aliases}`);
  });

  it("the server's refund note is matched in Russian", () => {
    const code = compiled("apps/mobile/src/features/finances/payment-history.ts");
    assert.match(code, /startsWith\((\/\*[^*]*\*\/\s*)?"Возврат"\)/);
  });

  it("wrong-email invitation is told by the server reply, not by the shown phrase", () => {
    const code = compiled("apps/mobile/app/invite/[token].tsx");
    assert.ok(!/actionError\??\.includes\(/.test(code), "the shown error is translated — never search it");
    assert.match(code, /\/does not match\/i\.test\(/);
  });
});
