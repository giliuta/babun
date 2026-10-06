import assert from "node:assert/strict";
import { describe, it } from "node:test";

// АНГЛИЙСКИЙ — БЕЗ ДЫР (06.10, повторная отправка в App Store). Фраза без
// перевода показывается по-русски, и сборка от этого не падает — так экраны
// входа, кода из письма и смены почты ушли на ревью наполовину русскими.
// Сторож гонит ТОТ ЖЕ каталог, что `check.js` (тот же плагин в режиме сбора),
// и требует английский перевод у каждой фразы кода. Серверные сообщения
// (`server-keys.json`) сюда не входят: их список растёт с миграциями, и
// переводятся они отдельным шагом.
//
// Упал — добавь перевод:
//   node apps/mobile/scripts/i18n/check.js --missing <файл вне репозитория>
//   … перевести на en, bg, el, uk, de, es …
//   node apps/mobile/scripts/i18n/check.js --merge <папка>

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildCatalog, loadDictionary } = require("./catalog") as {
  buildCatalog: () => {
    keys: Map<string, { file: string; line: number }[]>;
    errors: { file: string; message: string }[];
  };
  loadDictionary: (locale: string) => Record<string, string>;
};

describe("i18n: every phrase of the app has an English translation", () => {
  const catalog = buildCatalog();

  it("reads every source file — a file that does not parse hides its phrases", () => {
    assert.deepEqual(catalog.errors, []);
  });

  it("en.json translates every phrase the app looks up", () => {
    const en = loadDictionary("en");
    const missing = [...catalog.keys]
      .filter(([key]) => !en[key])
      .map(([key, uses]) => `${uses[0].file}:${uses[0].line}  ${JSON.stringify(key)}`);
    assert.deepEqual(missing, [], `no English translation:\n${missing.join("\n")}`);
  });
});
