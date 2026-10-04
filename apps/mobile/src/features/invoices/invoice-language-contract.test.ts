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

  // Владелец 2026-10-04: «в инвойсе не надо менять язык; если надо — пусть
  // переделывает полностью». Язык — в превью выставления и правки.
  test("у выставленного инвойса язык не переключается — только через «Изменить»", () => {
    const page = read("../../../app/invoices/[id].tsx");
    assert.doesNotMatch(page, /useSetInvoiceLanguage|Бумага на (русском|английском)/);
    assert.match(page, /useInvoiceMenu\(\)/);
    assert.match(read("invoice-menu.ts"), /label: "Изменить инвойс", run: edit/);
  });
});
