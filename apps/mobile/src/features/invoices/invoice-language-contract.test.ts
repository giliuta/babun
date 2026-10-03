import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// ЯЗЫК БУМАГИ НЕ ОСТАЁТСЯ РУССКИМ МОЛЧА (аудит 03.10). Язык пишется вторым
// запросом после выставления, ошибка глоталась, а переключателя на странице
// документа не было — английское превью уходило клиенту русской бумагой.

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("язык бумаги инвойса", () => {
  test("запись языка после выставления — вторая попытка, документ несёт записанный язык", () => {
    const queries = read("queries.ts");
    assert.match(queries, /for \(let attempt = 0; attempt < 2; attempt\+\+\) \{\s*try \{\s*await setInvoiceLanguage\(supabase, invoice\.id, language\);\s*return \{ \.\.\.invoice, language \};/);
  });

  test("не записался — экран выставления говорит об этом", () => {
    assert.match(read("../../../app/invoices/new.tsx"), /if \(value\.language && invoice\.language !== value\.language\) \{\s*notify\(/);
  });

  test("на странице документа язык переключается пунктом «⋯»", () => {
    const page = read("../../../app/invoices/[id].tsx");
    assert.match(page, /label: paperEnglish \? "Бумага на русском" : "Бумага на английском",\s*run: switchLanguage,/);
    assert.match(page, /setLanguage\.mutate\(paperEnglish \? "ru" : "en"/);
  });
});
