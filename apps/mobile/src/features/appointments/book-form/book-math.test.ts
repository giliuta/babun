import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Service } from "@/features/services/queries";
import { absoluteMinutes, first, serviceBuffersMinutes } from "./book-math";

const svc = (before: number | null, after: number | null) =>
  ({ buffer_before_min: before, buffer_after_min: after }) as Service;

describe("absoluteMinutes", () => {
  test("HH:MM and H:MM become minutes from midnight", () => {
    assert.equal(absoluteMinutes("00:00"), 0);
    assert.equal(absoluteMinutes("9:05"), 545);
    assert.equal(absoluteMinutes("23:59"), 1439);
  });

  test("24:00 is the end of the day, anything past it is not a time", () => {
    assert.equal(absoluteMinutes("24:00"), 1440);
    assert.equal(absoluteMinutes("24:30"), null);
    assert.equal(absoluteMinutes("25:00"), null);
    assert.equal(absoluteMinutes("10:60"), null);
  });

  test("garbage is null", () => {
    for (const bad of ["", "10", "10:0", "1000", "ab:cd", " 10:00", "10:00:00"]) {
      assert.equal(absoluteMinutes(bad), null, bad);
    }
  });
});

describe("first", () => {
  test("takes the first of an array param, passes a string, keeps undefined", () => {
    assert.equal(first(["a", "b"]), "a");
    assert.equal(first("x"), "x");
    assert.equal(first(undefined), undefined);
    assert.equal(first([]), undefined);
  });
});

describe("serviceBuffersMinutes", () => {
  test("buffers are the MAXIMUM before plus the MAXIMUM after, not a sum", () => {
    const catalog = new Map([
      ["a", svc(10, 5)],
      ["b", svc(15, 0)],
      ["c", svc(0, 20)],
    ]);
    assert.equal(serviceBuffersMinutes(["a", "b", "c"], catalog), 35);
    assert.equal(serviceBuffersMinutes(["a"], catalog), 15);
  });

  test("unknown services and empty buffers count as zero", () => {
    const catalog = new Map([["a", svc(null, null)]]);
    assert.equal(serviceBuffersMinutes(["a", "gone"], catalog), 0);
    assert.equal(serviceBuffersMinutes([], catalog), 0);
  });
});
