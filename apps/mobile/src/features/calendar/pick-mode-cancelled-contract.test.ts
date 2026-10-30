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
  test("a cancelled record neither draws nor takes a lane while free slots are shown", () => {
    assert.match(src, /const picking = freeSlots !== undefined;/);
    assert.match(src, /a\.event_all_day !== true && !\(picking && a\.status === "cancelled"\)/);
    assert.match(src, /lanes\.shown\.map\(\(p\) => \(/);
  });
});
