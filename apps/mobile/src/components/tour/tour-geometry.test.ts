import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BUBBLE_SIDE, CONTROL_PAD, EDGE, caretOffset, clampToScreen, placeBubble, spotFor } from "./tour-geometry";

const screen = { w: 440, h: 956 };

describe("вырез по форме цели", () => {
  test("строка карточки — ровно по карточке, со скруглением карточки", () => {
    const { spot, radius } = spotFor({ x: 16, y: 100, w: 408, h: 60 }, "card", screen, 10);
    assert.deepEqual(spot, { x: 16, y: 100, w: 408, h: 60 });
    assert.equal(radius, 10);
  });

  test("кнопка — ровный отступ со всех сторон и скругление больше на отступ", () => {
    const { spot, radius } = spotFor({ x: 100, y: 100, w: 44, h: 44 }, "control", screen, 10);
    assert.deepEqual(spot, { x: 100 - CONTROL_PAD, y: 100 - CONTROL_PAD, w: 44 + CONTROL_PAD * 2, h: 44 + CONTROL_PAD * 2 });
    assert.equal(radius, 10 + CONTROL_PAD);
  });

  test("полоса — во всю ширину, без скругления и без поля у края", () => {
    const { spot, radius } = spotFor({ x: 0, y: 200, w: 440, h: 50 }, "strip", screen, 10);
    assert.deepEqual(spot, { x: 0, y: 200, w: 440, h: 50 });
    assert.equal(radius, 0);
  });

  test("значок у края экрана: вырез сжат поровну, цель посередине", () => {
    const icon = { x: 396, y: 50, w: 44, h: 44 };
    const { spot } = spotFor(icon, "control", screen, 10);
    assert.ok(spot.x + spot.w <= screen.w - EDGE);
    const iconCenter = icon.x + icon.w / 2;
    assert.equal(spot.x + spot.w / 2, iconCenter);
  });

  test("внутри экрана вырез не меняется", () => {
    const r = { x: 50, y: 50, w: 100, h: 40 };
    assert.deepEqual(clampToScreen(r, screen), r);
  });
});

describe("место пузыря", () => {
  test("под целью, если внизу хватает места", () => {
    const placed = placeBubble({ x: 16, y: 100, w: 408, h: 60 }, null, 150, screen, 0);
    assert.equal(placed.side, "below");
    assert.ok(placed.top > 160);
  });

  test("над целью, если внизу места нет", () => {
    const placed = placeBubble({ x: 16, y: 800, w: 408, h: 60 }, null, 150, screen, 0);
    assert.equal(placed.side, "above");
    assert.ok(placed.top + 150 < 800);
  });

  test("клавиатура срезает низ: пузырь уходит над полем", () => {
    const field = { x: 16, y: 560, w: 408, h: 50 };
    assert.equal(placeBubble(field, null, 150, screen, 0).side, "below");
    assert.equal(placeBubble(field, null, 150, screen, 340).side, "above");
  });

  test("не закрывает то, что шаг просит оставить на виду", () => {
    const button = { x: 16, y: 860, w: 408, h: 50 };
    const nameRow = { x: 16, y: 800, w: 408, h: 50 };
    const placed = placeBubble(button, nameRow, 150, screen, 0);
    assert.equal(placed.side, "above");
    assert.ok(placed.top + 150 <= nameRow.y);
  });

  test("цель во весь экран — пузырь у нижнего края поверх неё", () => {
    const grid = { x: 0, y: 40, w: 440, h: 880 };
    assert.equal(placeBubble(grid, null, 150, screen, 0).side, "over");
  });
});

describe("стрелка пузыря", () => {
  test("смотрит на середину выреза", () => {
    const spot = { x: 200, y: 100, w: 40, h: 40 };
    assert.equal(caretOffset(spot, screen), 220 - BUBBLE_SIDE);
  });

  test("у края экрана не заходит на скруглённый угол пузыря", () => {
    const left = caretOffset({ x: 0, y: 50, w: 20, h: 20 }, screen);
    const right = caretOffset({ x: 420, y: 50, w: 20, h: 20 }, screen);
    assert.ok(left >= 20);
    assert.ok(right <= screen.w - BUBBLE_SIDE * 2 - 20);
  });
});
