import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { headerRu } from "./header-ru";

describe("headerRu", () => {
  test("today and tomorrow by business date", () => {
    assert.equal(headerRu("2026-10-13", "2026-10-13", "2026-10-14"), "Сегодня");
    assert.equal(headerRu("2026-10-14", "2026-10-13", "2026-10-14"), "Завтра");
  });

  test("other days — one capitalised short weekday, with or without a day label", () => {
    assert.match(headerRu("2026-10-19", "2026-10-13", "2026-10-14"), /^Пн, 19 октября$/);
  });
});

test("шапка дня «Списка» — капс caption 11/700, как DayDivider у остальных лент", () => {
  const src = readFileSync(join(__dirname, "DaySection.tsx"), "utf8");
  assert.match(src, /style=\{\{ \.\.\.TYPE\.caption, textTransform: "uppercase", color: t\.sub \}\}/);
  assert.doesNotMatch(src, /fontSize: 12,\s*fontWeight: "600"/);
});
