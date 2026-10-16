import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ИЗ КОНТАКТОВ ТЕЛЕФОНА»: ЗАКРЫЛ ЛИСТ — ДОБАВЛЕНИЕ ОСТАНОВЛЕНО НАСОВСЕМ.
// Общий флаг «отменено» сбрасывался при следующем открытии листа, и цикл
// прошлого запуска, ещё ждавший сервер, видел «не отменено» и досоздавал
// клиентов, от которых уже отказались, а в конце закрывал НОВЫЙ лист.
// Поэтому у запуска своё поколение: закрытие его меняет, открытие — нет.
// Экран импортировать нельзя (react-native), проверяем по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(here, "ContactsImportSheet.tsx"), "utf8");

test("общего флага отмены, который сбрасывает открытие, нет", () => {
  assert.doesNotMatch(sheet, /cancelled\.current = false/);
  assert.doesNotMatch(sheet, /cancelled = useRef/);
});

test("цикл держит своё поколение, закрытие листа его меняет", () => {
  assert.match(sheet, /const generation = useRef\(0\);/);
  assert.match(sheet, /const gen = generation\.current;/);
  assert.match(sheet, /if \(generation\.current !== gen\) break;/);
  assert.match(sheet, /generation\.current \+= 1;\s*onClose\(\);/);
});

test("устаревший запуск не закрывает новый лист", () => {
  assert.match(sheet, /if \(generation\.current === gen\) onClose\(\);/);
});
