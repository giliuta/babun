import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sectionColumns, segmentSlot } from "./rights-columns";

describe("сетка прав: каждое положение в своей колонке", () => {
  test("лестница «Не видит · Видит · Меняет»", () => {
    assert.deepEqual(segmentSlot(["off", "read", "write"]), { start: 0 });
    assert.deepEqual(segmentSlot(["off", "read"]), { start: 0 });
    assert.deepEqual(segmentSlot(["read", "write"]), { start: 1 });
  });

  test("разрыв или чужие положения — вне сетки", () => {
    assert.equal(segmentSlot(["off", "write"]), null);
    assert.equal(segmentSlot(["own", "all"]), null);
    assert.equal(segmentSlot([]), null);
  });

  test("колонок у блока — по самому длинному сегменту", () => {
    assert.equal(sectionColumns([{ levels: ["off", "read"] }, { levels: ["off", "read", "write"] }]), 3);
    assert.equal(sectionColumns([{ levels: ["off", "read"] }]), 2);
    assert.equal(sectionColumns([{ levels: ["own", "all"] }]), 0);
  });
});
