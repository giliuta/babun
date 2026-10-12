import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHIP_GAP, dropIndex, shiftOf } from "./chip-drag-math";

// ПОРЯДОК КАЛЕНДАРЕЙ — ЗАЖАТЬ И ПЕРЕТАЩИТЬ В ЛЕНТЕ ШЕСТЕРЁНКИ (владелец 11.10).

// «Личный» 80, «Y&D» 50, «Команда 2» 100 — чипы разной ширины.
const boxes = [
  { x: 20, w: 80 },
  { x: 108, w: 50 },
  { x: 166, w: 100 },
];

describe("место чипа под пальцем", () => {
  test("не сдвинули — своё место", () => {
    for (let i = 0; i < boxes.length; i++) {
      assert.equal(dropIndex(boxes, i, boxes[i].x + boxes[i].w / 2), i);
    }
  });

  test("первый за центр последнего — встаёт последним", () => {
    assert.equal(dropIndex(boxes, 0, 166 + 50 + 1), 2);
  });

  test("последний за центр первого — встаёт первым", () => {
    assert.equal(dropIndex(boxes, 2, 20 + 40 - 1), 0);
  });

  test("соседи расступаются на ширину тянущегося чипа", () => {
    // Тянем «Личный» (0) на место 2: «Y&D» и «Команда 2» уходят влево.
    assert.equal(shiftOf(1, 0, 2, 80), -(80 + CHIP_GAP));
    assert.equal(shiftOf(2, 0, 2, 80), -(80 + CHIP_GAP));
    // Тянем «Команда 2» (2) на место 0: остальные — вправо.
    assert.equal(shiftOf(0, 2, 0, 100), 100 + CHIP_GAP);
    assert.equal(shiftOf(1, 2, 0, 100), 100 + CHIP_GAP);
    assert.equal(shiftOf(1, -1, -1, 0), 0);
  });
});

test("шестерёнка календаря: лента перетаскивается, отдельной страницы порядка нет", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const gear = readFileSync(resolve(here, "../../../app/(dashboard)/(home)/calendar/index.tsx"), "utf8");
  assert.match(gear, /onReorder=\{\(ids\) =>\s*saveCalendarOrder\.mutate\(/);
  assert.doesNotMatch(gear, /calendar\/order/);
  assert.throws(() => readFileSync(resolve(here, "../../../app/(dashboard)/(home)/calendar/order.tsx")));
  const chips = readFileSync(resolve(here, "ScopeChips.tsx"), "utf8");
  assert.match(chips, /scrollEnabled=\{!dragging\}/);
  assert.match(chips, /if \(justDragged\.current\) return;/);
  const drag = readFileSync(resolve(here, "chip-drag.tsx"), "utf8");
  assert.match(drag, /\.activateAfterLongPress\(350\)/);
  // В worklet — не методы объектов (падало на UI-рантайме).
  assert.doesNotMatch(drag, /runOnJS\((haptics|drag)\./);
});

test("место чипа — из порядка и ширин: отпускание ставит ровно в ячейку (11.10)", async () => {
  const { slotX, CHIP_GAP: GAP } = await import("./chip-drag-math");
  const widths = { a: 80, b: 50, c: 100 };
  assert.equal(slotX(["a", "b", "c"], widths, 0, 0), 0);
  assert.equal(slotX(["a", "b", "c"], widths, 2, 0), 80 + GAP + 50 + GAP);
  // Переставили «c» первым — «a» встаёт за ним на ширину «c».
  assert.equal(slotX(["c", "a", "b"], widths, 1, 0), 100 + GAP);
  const here = dirname(fileURLToPath(import.meta.url));
  const drag = readFileSync(resolve(here, "chip-drag.tsx"), "utf8");
  // Новый порядок пишется на потоке UI в миг отпускания, одной записью.
  assert.match(drag, /order\.value = next;\s*settleId\.value = id;/);
  assert.match(drag, /position: "absolute", left: 0, top: 0/);
});
