import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { autoMapHeaders } from "./csv-mapping";

// ПОВТОРНЫЙ ИМПОРТ СВОЕЙ ВЫГРУЗКИ (повторный аудит 03.10): «Метка» — заголовок
// `bulk-export.ts`, и при обратном импорте колонка оставалась «не
// импортировать».
describe("autoMapHeaders", () => {
  test("выгрузка «Имя;Телефон;Метка;Долг;Теги» — метка находит своё поле", () => {
    assert.deepEqual(autoMapHeaders(["Имя", "Телефон", "Метка", "Долг", "Теги"]), [
      "full_name",
      "phone",
      "city",
      "skip",
      "skip",
    ]);
  });

  test("«Заметка» — заметка, а не метка", () => {
    assert.deepEqual(autoMapHeaders(["Заметка", "Метка"]), ["comment", "city"]);
  });

  test("«Город» и «Адрес» по-прежнему", () => {
    assert.deepEqual(autoMapHeaders(["Город", "Адрес"]), ["city", "address"]);
  });
});
