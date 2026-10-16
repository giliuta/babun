import assert from "node:assert/strict";
import { describe, test } from "node:test";
import path from "node:path";
import { readModuleSource } from "@/lib/module-source";

// ОТМЕНЁННАЯ ЗАПИСЬ В РЕЖИМЕ ВЫБОРА ВРЕМЕНИ. «Копировать» и
// «Перенести» рисуют зелёные кубики свободного времени; отменённая запись
// время не держит, кубик лежит прямо под ней — а карточка ложилась сверху:
// зачёркнутое «Тест Календарь» и «11:00» кубика читались одно поверх другого,
// и тап по кубику открывал отменённую запись вместо выбора времени.

// The day grid is `DayView.tsx` plus its parts in `day-view/`.
const src = readModuleSource(path.join(__dirname, "DayView.tsx"), path.join(__dirname, "day-view"));

describe("slot-pick mode hides cancelled blocks", () => {
  test("a cancelled placement is skipped while free slots are shown", () => {
    const loop = src.slice(src.indexOf("? placements.map((p) => {\n            // ОТМЕНЁННАЯ"));
    assert.ok(loop.length > 0, "the block loop is where it was");
    assert.match(loop, /if \(freeSlots !== undefined && p\.apt\.status === "cancelled"\) return null;/);
  });
});
