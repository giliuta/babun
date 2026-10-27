import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// «ПОДЕЛИТЬСЯ» ИНВОЙСА БЕЗ ПЯТИ СЕКУНД СПИННЕРА: страница
// печатает PDF заранее, кнопка берёт готовый файл. По исходнику: печать — это
// expo-print в скрытом WebView, под node её не запустить.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, "../..", file), "utf8");
const primitive = read("lib/share-pdf.ts");
const detail = read("features/invoices/detail/use-invoice-detail.ts");

describe("готовый PDF", () => {
  test("заготовка одна и узнаётся по имени и HTML", () => {
    assert.match(primitive, /let prepared: \{ key: string; uri: Promise<string> \} \| null = null;/);
    assert.match(primitive, /const key = `\$\{fileName\}\\n\$\{html\}`;/);
    assert.match(primitive, /if \(prepared\?\.key === key\) return prepared\.uri;/);
  });

  test("«Поделиться» берёт заготовку, стёртую — печатает заново", () => {
    assert.match(primitive, /let sendUri = await preparedFile\(html, fileName\);/);
    assert.match(primitive, /if \(!fileExists\(FileSystem, sendUri\)\) \{\s*prepared = null;/);
  });

  test("неудачная заготовка не застревает", () => {
    assert.match(primitive, /if \(prepared === entry\) prepared = null;/);
  });

  test("веб заготовку не печатает — он печатает сам документ по нажатию", () => {
    assert.match(primitive, /export function preparePdf\(.*\): void \{\s*if \(typeof document !== "undefined"\) return;/);
  });
});

describe("страница инвойса", () => {
  test("готовит PDF заранее тем же входом, что и «Поделиться», и только тем, кто может поделиться", () => {
    assert.match(detail, /const pdfReady = docWrite && !!pdfInput;/);
    assert.match(detail, /prepareInvoicePdf\(preparedInput\.current\)/);
    assert.match(detail, /await shareInvoicePdf\(pdfInput\);/);
  });
});
