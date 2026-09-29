import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { monthTitle, weekTitle } from "./header-title";

describe("заголовок календаря", () => {
  test("неделя внутри месяца — полное имя месяца", () => {
    assert.equal(weekTitle(new Date(2026, 8, 21), new Date(2026, 8, 27)), "Сентябрь 2026");
  });
  test("неделя на стыке месяцев — оба коротко", () => {
    assert.equal(weekTitle(new Date(2026, 8, 28), new Date(2026, 9, 4)), "Сен – Окт 2026");
  });
  test("неделя на стыке лет — с годами", () => {
    assert.equal(weekTitle(new Date(2026, 11, 28), new Date(2027, 0, 3)), "Дек 2026 – Янв 2027");
  });
  test("месяц и день", () => {
    assert.equal(monthTitle(new Date(2026, 8, 29)), "Сентябрь 2026");
  });
});
