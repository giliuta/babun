import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { archivedVisitTag } from "./archived-visit";

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

