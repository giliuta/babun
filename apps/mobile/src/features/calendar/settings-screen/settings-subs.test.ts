import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bookingSubtitle, labelsSubtitle, windowSpanHours } from "./settings-subs";

describe("bookingSubtitle", () => {
  test("rule label and «все блоки» when every block is on", () => {
    assert.equal(bookingSubtitle("По услуге", 7, 7), "По услуге · все блоки");
  });

  test("falls back to the team colour and counts the blocks", () => {
    assert.equal(bookingSubtitle(undefined, 3, 7), "Цвет команды · 3 из 7 блоков");
  });
});

describe("labelsSubtitle", () => {
  test("empty — says so", () => {
    assert.equal(labelsSubtitle([]), "Пока нет меток");
    assert.equal(labelsSubtitle(["", null]), "Пока нет меток");
  });

  test("up to three names are listed", () => {
    assert.equal(labelsSubtitle(["Лимассол", "Пафос"]), "Лимассол, Пафос");
  });

  test("more than three — head plus the rest counted", () => {
    assert.equal(labelsSubtitle(["a", "b", "c", "d", "e"]), "a, b, c и ещё 2");
  });
});

describe("windowSpanHours", () => {
  const at = (hour: number, minute = 0) => ({ hour, minute });

  test("whole hours", () => {
    assert.equal(windowSpanHours({ start: at(6), end: at(20) }), 14);
  });

  test("minutes round outward", () => {
    assert.equal(windowSpanHours({ start: at(6, 30), end: at(20, 15) }), 15);
  });

  test("never below one hour", () => {
    assert.equal(windowSpanHours({ start: at(10), end: at(10) }), 1);
  });
});
