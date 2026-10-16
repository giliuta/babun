import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { headerRu } from "./header-ru";

describe("headerRu", () => {
  test("today and tomorrow by business date", () => {
    assert.equal(headerRu("2026-10-13", "2026-10-13", "2026-10-14"), "Сегодня");
    assert.equal(headerRu("2026-10-14", "2026-10-13", "2026-10-14"), "Завтра");
  });

  test("other days — capitalised long weekday, short with a day label", () => {
    const long = headerRu("2026-10-19", "2026-10-13", "2026-10-14");
    const short = headerRu("2026-10-19", "2026-10-13", "2026-10-14", true);
    assert.match(long, /^Понедельник, 19 октября$/);
    assert.match(short, /^Пн, 19 октября$/);
  });
});
