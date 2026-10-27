import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// СКРЫТОЕ ЮРЛИЦО НЕ ПОДМЕНЯЕТСЯ ОСНОВНЫМ. Документ, выпущенный
// от набора, который потом скрыли, в правке, кредит-ноте и возврате по чеку
// показывал продавцом набор по умолчанию — чужое имя рядом с номером из серии
// скрытого. По исходнику: модули тянут react-native.
const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(here, file), "utf8");

test("блок «Реквизиты» показывает выбранный набор, даже скрытый", () => {
  assert.match(read("InvoiceRequisitesBlock.tsx"), /const company = rows\.find\(\(c\) => c\.id === companyId\) \?\? defaultCompany\(rows\);/);
});

test("бумага правки — от набора документа, даже скрытого", () => {
  assert.match(read("invoice-editor/use-invoice-paper.ts"), /rows\.filter\(\(row\) => existing \|\| !row\.archived_at\)/);
});
