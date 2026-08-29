import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isoWeekday } from "./iso-weekday";

describe("ISO-номер дня недели", () => {
  test("понедельник — 1, воскресенье — 7", () => {
    // 2026-08-31 — понедельник, 2026-09-06 — воскресенье.
    assert.equal(isoWeekday("2026-08-31"), 1);
    assert.equal(isoWeekday("2026-09-01"), 2);
    assert.equal(isoWeekday("2026-09-05"), 6);
    assert.equal(isoWeekday("2026-09-06"), 7);
  });

  test("ВОСКРЕСЕНЬЕ НЕ ПРЕВРАЩАЕТСЯ В НОЛЬ", () => {
    // `Date.getDay()` отдаёт 0, и без сдвига воскресенье не совпало бы ни с
    // одним днём расписания — метка молча не встала бы именно в выходной.
    assert.notEqual(isoWeekday("2026-09-06"), 0);
  });

  test("дата разбирается как календарная, без сдвига зоной", () => {
    // `new Date("2026-09-06")` — это полночь UTC; восточнее Гринвича
    // `getDay()` вернул бы субботу. Разбор строкой этого не допускает.
    assert.equal(isoWeekday("2026-09-06"), 7);
    assert.equal(isoWeekday("2026-01-01"), 4);
  });

  test("мусор не роняет календарь", () => {
    assert.equal(isoWeekday(""), 1);
    assert.equal(isoWeekday("не дата"), 1);
  });
});
