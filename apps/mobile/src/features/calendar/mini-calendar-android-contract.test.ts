import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// МИНИ-КАЛЕНДАРЬ НА ANDROID (13.10, проверено на эмуляторе Android 16).
const src = readFileSync(join(__dirname, "MiniCalendar.tsx"), "utf8");

test("сетка дней ровно в семь ячеек: перенос не уносит воскресенье", () => {
  // Страница ленты на долю пикселя уже 7 × CELL — седьмая ячейка уходила на
  // новую строку, и все даты вставали под чужой день недели.
  assert.match(src, /flexWrap: "wrap", width: 7 \* CELL \}/);
});

test("Modal со своим GestureHandlerRootView: свайп месяцев доходит", () => {
  const modal = src.slice(src.indexOf("<Modal"), src.indexOf("</Modal>"));
  assert.match(modal, /<GestureHandlerRootView style=\{\{ flex: 1 \}\}>/);
  assert.ok(modal.indexOf("<GestureHandlerRootView") < modal.indexOf("<GestureDetector"));
});
