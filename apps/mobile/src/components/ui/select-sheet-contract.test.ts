import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// ШТОРКА ВЫБОРА ОДНА НА ПРОДУКТ — И ЭТО ПРОВЕРЯЕТСЯ, А НЕ ОБЕЩАЕТСЯ
// (владелец 2026-09-10: «архитектура этой шторки должна быть везде
// одинаковая»).
//
// Канон был записан комментарием внутри `BookingPickers` — и следовали ему две
// шторки из семи, потому что следовать было нечему: строка лежала копиями.
// Копии разошлись до трёх высот (44/48/52), трёх полей поиска и трёх способов
// нарисовать заголовок. Тест сторожит ровно это: строку и поиск рисует общий
// примитив, шапку задаёт проп.

/** Все шторки, где ВЫБИРАЮТ из списка. Новая шторка выбора добавляется сюда
 *  тем же коммитом, которым появляется. */
const SHEETS = [
  "../../features/clients/ClientPickerSheet.tsx",
  "../../features/clients/ObjectPickerSheet.tsx",
  "../../features/clients/TagPickerSheet.tsx",
  "../../features/reference/LabelPickerSheet.tsx",
  "../../features/invoices/EntityPickerSheet.tsx",
  "../../features/appointments/BookingPickers.tsx",
  "./PickerSheet.tsx",
  "./ValuePickerSheet.tsx",
];

describe("анатомия шторки выбора", () => {
  test("строку рисует только общий примитив", () => {
    for (const path of SHEETS) {
      const source = read(path);
      // Своя высота строки = своя анатомия. Единственное законное место, где
      // высота названа числом, — сам примитив.
      assert.doesNotMatch(
        source,
        /minHeight: 4[48]|minHeight: 5[26]/,
        `${path}: своя высота строки вместо SelectRow`,
      );
      assert.match(
        source,
        /SelectRow|ValueOptionList/,
        `${path}: строка собрана руками, а не общим примитивом`,
      );
    }
  });

  test("поиск — общий, второго поля в шторках не бывает", () => {
    for (const path of SHEETS) {
      const source = read(path);
      assert.doesNotMatch(
        source,
        /<TextInput/,
        `${path}: своё поле поиска вместо SelectSearch`,
      );
    }
  });

  test("шапка задаётся пропом, а не рисуется в теле", () => {
    for (const path of SHEETS) {
      const source = read(path);
      assert.match(
        source,
        /title=\{|title="/,
        `${path}: у шторки нет title — заголовок нарисован вручную`,
      );
      assert.doesNotMatch(
        source,
        /accessibilityRole="header"/,
        `${path}: свой заголовок в теле шторки`,
      );
    }
  });

  test("примитив строки держит канон: 52pt, кружок 28, имя 15/600", () => {
    const row = read("./select-rows.tsx");
    assert.match(row, /minHeight: 52/);
    assert.match(row, /const CIRCLE = 28/);
    assert.match(row, /fontSize: 15, fontWeight: "600"/);
    // Галка у выбранной и тонировка строки — признак выбора, а не рамка.
    assert.match(row, /<Check color=\{t\.accent\}/);
    assert.doesNotMatch(row, /borderWidth/);
  });
});
