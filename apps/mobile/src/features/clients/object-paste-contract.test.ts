import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ВСТАВИТЬ» В НОВОМ ОБЪЕКТЕ ЕСТЬ ВСЕГДА. На iOS `contextMenuHidden` прячет
// меню поля целиком — и «Скопировать», и «Вставить». Запрет выноса
// (`caps.export`) должен закрывать копирование сохранённого объекта, а не
// ввод: без вставки ссылку на карту в адрес нового объекта не положить.
// Компоненты тянут react-native — проверка по исходнику.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

test("форма объекта прячет меню только у сохранённого объекта без права выноса", () => {
  const fields = read("ObjectFields.tsx");
  assert.match(fields, /const noCopy = !draft && !caps\.export;/);
  assert.doesNotMatch(fields, /=\{!caps\.export\}/, "поле формы снова прячет меню мимо `draft`");
  assert.match(fields, /<AddressDetailsFields[\s\S]{0,200}?noCopy=\{noCopy\}/);
});

test("лист нового объекта — черновик", () => {
  const sheet = read("ObjectSheet.tsx");
  assert.match(sheet, /title="Новый объект"\s*draft\b/);
  assert.match(sheet, /draft=\{!initial\}/);
  assert.match(sheet, /<ObjectFields[\s\S]{0,120}?draft=\{draft\}/);
});

test("точный адрес слушается формы, а без неё — права выноса", () => {
  const parts = read("AddressPartsFields.tsx");
  assert.match(parts, /const hideMenu = noCopy \?\? !caps\.export;/);
  assert.equal(parts.match(/noCopy=\{hideMenu\}/g)?.length, 4);
  assert.match(parts, /contextMenuHidden=\{noCopy\}/);
});
