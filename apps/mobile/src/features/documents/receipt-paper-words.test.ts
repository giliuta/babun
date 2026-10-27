import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// РУССКИЕ СЛОВА НЕ ВШИВАЮТСЯ В АНГЛИЙСКИЙ ЧЕК. Чек неизменяем:
// строка «Оплата», «Услуга» вместо снятой из прайса услуги и номер «Черновик»
// оставались на английской бумаге навсегда. По исходнику: экран тянет react-native.
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../../app/documents");

test("строка чека оплаты — словом бумаги на её языке", () => {
  const source = readFileSync(resolve(here, "use-receipt-source.ts"), "utf8");
  assert.match(source, /paperWords\(invoiceRow\?\.language\)\.payment/);
  assert.doesNotMatch(source, /"Оплата по инвойсу|: "Оплата",/);
});

test("составитель чека: снятые услуги по имени, слова «без названия» и «номер позже» — из словаря", () => {
  const screen = readFileSync(resolve(app, "receipt-new.tsx"), "utf8");
  assert.match(screen, /const services = useAllServices\(\);/);
  assert.match(screen, /\?\? paperWords\.untitled;/);
  assert.match(screen, /\?\? paperWords\.numberPending,/);
  assert.doesNotMatch(screen, /"Черновик",|\?\? "Услуга"/);
});
