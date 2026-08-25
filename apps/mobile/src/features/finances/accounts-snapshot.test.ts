import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { snapshotNote } from "./accounts-snapshot";

// Метка несвежести — единственное, что человек читает про возраст цифр на
// экране денег. Она обязана быть честной в обе стороны: не врать про офлайн
// со связью и не выдавать позавчерашние цифры за «только что».

const at = new Date(2026, 7, 10, 14, 32).getTime(); // 10 августа, 14:32

describe("snapshotNote", () => {
  test("без сети — с хвостом, со связью — без него", () => {
    const now = new Date(2026, 7, 10, 15, 0);
    assert.equal(snapshotNote(at, now, false), "Данные на 14:32 · нет сети");
    assert.equal(snapshotNote(at, now, true), "Данные на 14:32");
  });

  test("вчерашний снимок называет день, а не одно время", () => {
    const now = new Date(2026, 7, 11, 9, 5);
    assert.equal(
      snapshotNote(at, now, false),
      "Данные на 10 августа, 14:32 · нет сети",
    );
  });

  test("часы с ведущим нулём — как на системных часах", () => {
    const early = new Date(2026, 7, 10, 9, 5).getTime();
    assert.equal(
      snapshotNote(early, new Date(2026, 7, 10, 10, 0), false),
      "Данные на 09:05 · нет сети",
    );
  });
});
