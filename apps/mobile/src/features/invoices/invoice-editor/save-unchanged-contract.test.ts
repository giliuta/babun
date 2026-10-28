import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «СОХРАНИТЬ ИНВОЙС» БЕЗ ПРАВОК — СЕРАЯ. Компоненты тянут react-native и под
// раннером не поднимаются — проверка идёт по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("правка без правок не открывает превью", () => {
  const editor = read("../InvoiceEditor.tsx");
  assert.match(editor, /const unchanged = !!existing && !paper\.dirty && language === bornLanguage;/);
  assert.match(editor, /unchanged=\{unchanged\}/);
  const footer = read("InvoiceEditorFooter.tsx");
  assert.match(footer, /disabled=\{submitting \|\| reason !== null \|\| unchanged\}/);
});
