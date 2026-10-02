import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { labelsSummary, listRowSummary, objectsSummary } from "./settings-summary";

// Подписи строк шестерёнки «Клиентов» (02.10, «по функциям»).

describe("подписи настроек клиентов", () => {
  test("строка в списке", () => {
    assert.equal(listRowSummary({ phone: true, last: true }), "Телефон · Последняя запись");
    assert.equal(listRowSummary({ phone: false, last: false }), "Только имя");
  });

  test("объекты: выключены, без типов, с типами", () => {
    assert.equal(objectsSummary({ on: false, types: ["Дом"], service: "x", maps: "y" }), "Выключены в карточке");
    assert.equal(
      objectsSummary({ on: true, types: ["Дом", "Квартира", "Офис"], service: "Не напоминать", maps: "Google Карты" }),
      "Дом, Квартира… · Не напоминать · Google Карты",
    );
    assert.equal(objectsSummary({ on: true, types: [], service: "Раз в год", maps: "" }), "Типов нет · Раз в год");
  });

  test("метка и тег", () => {
    assert.equal(labelsSummary(false, 4), "Выключены в карточке");
    assert.equal(labelsSummary(true, 0), "Тегов пока нет");
    assert.equal(labelsSummary(true, 1), "1 тег");
    assert.equal(labelsSummary(true, 4), "4 тега");
    assert.equal(labelsSummary(true, 11), "11 тегов");
  });
});
