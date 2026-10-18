import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync, type PluginItem } from "@babel/core";

// ПРИЧИНА ПО УМОЛЧАНИЮ НЕ ПЕЧАТАЕТСЯ НА ЛЮБОМ ЯЗЫКЕ ИНТЕРФЕЙСА. Экраны ноты
// подставляют её шаблоном, и i18n-плагин переводит его при сборке («Отмена
// инвойса {0}» → «Cancellation of invoice {0}»). Бумага узнавала причину одной
// русской регуляркой (RegExp плагин не трогает) — и превью на английском
// интерфейсе печатало её в примечаниях. Тесты babel не гоняют, поэтому сторож
// прогоняет плагин сам: бумага обязана сравнивать с ТЕМИ ЖЕ фразами, что
// подставляют экраны.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../../../scripts/i18n/babel-plugin") as PluginItem;
const here = dirname(fileURLToPath(import.meta.url));

function translated(rel: string): string {
  const filename = resolve(here, rel);
  const out = transformSync(readFileSync(filename, "utf8"), {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    generatorOpts: { jsescOption: { minimal: true } },
    plugins: [[plugin, { collect: () => undefined }]],
  });
  return out?.code ?? "";
}

const phrases = (code: string) =>
  new Set([...code.matchAll(/__i18n_tf\("((?:Частичная отмена инвойса|Отмена инвойса|Возврат по чеку) \{0\})"/g)].map((m) => m[1]));

describe("причина кредит-ноты по умолчанию", () => {
  test("бумага узнаёт переведённые причины экранов", () => {
    const screens = new Set([
      ...phrases(translated("../../../app/invoices/credit-note.tsx")),
      ...phrases(translated("../../../app/documents/receipt-refund.tsx")),
    ]);
    assert.ok(screens.size >= 3, [...screens].join(" | "));
    const paper = phrases(translated("../../lib/paper/document/issued.ts"));
    for (const phrase of screens) assert.ok(paper.has(phrase), `бумага не узнаёт «${phrase}»`);
  });
});
