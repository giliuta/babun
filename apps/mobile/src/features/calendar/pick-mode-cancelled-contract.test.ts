import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// ОТМЕНЁННАЯ ЗАПИСЬ В РЕЖИМЕ ВЫБОРА ВРЕМЕНИ (прогон 03.10). «Копировать» и
// «Перенести» рисуют зелёные кубики свободного времени; отменённая запись
// время не держит, кубик лежит прямо под ней — а карточка ложилась сверху:
// зачёркнутое «Тест Календарь» и «11:00» кубика читались одно поверх другого,
// и тап по кубику открывал отменённую запись вместо выбора времени.

const src = readFileSync(path.join(__dirname, "DayView.tsx"), "utf8");

describe("slot-pick mode hides cancelled blocks", () => {
  test("a cancelled placement is skipped while free slots are shown", () => {
    const loop = src.slice(src.indexOf("? placements.map((p) => {\n            // ОТМЕНЁННАЯ"));
    assert.ok(loop.length > 0, "the block loop is where it was");
    assert.match(loop, /if \(freeSlots !== undefined && p\.apt\.status === "cancelled"\) return null;/);
  });
});
