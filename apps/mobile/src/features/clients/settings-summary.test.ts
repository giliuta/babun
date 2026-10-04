import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { blocksSummary, listRowSummary, objectTypesSummary, tagsSummary } from "./settings-summary";

// Подписи строк шестерёнки «Клиентов» (02.10, «по функциям»).

describe("подписи настроек клиентов", () => {
  test("строка в списке", () => {
    assert.equal(listRowSummary({ phone: true, last: true }), "Телефон · Последняя запись");
    assert.equal(listRowSummary({ phone: false, last: false }), "Только имя");
  });

  test("типы объектов", () => {
    assert.equal(objectTypesSummary([]), "Типов нет");
    assert.equal(objectTypesSummary(["Дом", "Квартира"]), "Дом, Квартира");
    assert.equal(objectTypesSummary(["Дом", "Квартира", "Офис"]), "Дом, Квартира…");
  });

  test("теги", () => {
    assert.equal(tagsSummary(0), "Тегов пока нет");
    assert.equal(tagsSummary(1), "1 тег");
    assert.equal(tagsSummary(4), "4 тега");
    assert.equal(tagsSummary(11), "11 тегов");
  });

  test("блоки клиентов", () => {
    assert.equal(blocksSummary([]), "Все блоки");
    assert.equal(blocksSummary(["тег", "личное"]), "Без: тег, личное");
  });
});
