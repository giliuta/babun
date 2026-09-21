import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { archivedVisitTag, visitRowValue } from "./archived-visit";

const teams = new Map([
  ["live", { id: "live", name: "Команда 1", is_active: true }],
  ["gone", { id: "gone", name: "Команда 2", is_active: false }],
]);

describe("визит архивного календаря называет команду", () => {
  test("архивный — имя и пометка", () => {
    assert.equal(archivedVisitTag("gone", teams), "Команда 2 · в архиве");
  });

  test("живой и без команды — молчат", () => {
    assert.equal(archivedVisitTag("live", teams), null);
    assert.equal(archivedVisitTag(null, teams), null);
  });

  // Стёртый календарь уносит свои записи — такого визита не бывает; а если
  // ссылка всё же висит, гадать имя нельзя.
  test("неизвестная команда — молчит", () => {
    assert.equal(archivedVisitTag("unknown", teams), null);
  });
});

describe("значение строки истории", () => {
  test("архивный: команда и деньги, услуги не теснят сумму", () => {
    assert.equal(
      visitRowValue({ tag: "Команда 2 · в архиве", details: ["Клининг"], money: "€140" }),
      "Команда 2 · в архиве · €140",
    );
  });

  test("живой: как было — услуги, заметка, деньги", () => {
    assert.equal(
      visitRowValue({ tag: null, details: ["Клининг", null, "звонила"], money: "€140" }),
      "Клининг · звонила · €140",
    );
  });

  test("без денег — без хвостовой точки", () => {
    assert.equal(
      visitRowValue({ tag: "Команда 2 · в архиве", details: [], money: null }),
      "Команда 2 · в архиве",
    );
  });
});
