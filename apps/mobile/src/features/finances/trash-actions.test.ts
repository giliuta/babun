import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { NOT_IN_TRASH, createRowGuard, trashAlreadyGone } from "./trash-actions";

const here = dirname(fileURLToPath(import.meta.url));

describe("«Вернуть» и «Удалить насовсем» в корзине операций", () => {
  test("«нет в ящике» — это «уже сделано», а не поломка", () => {
    assert.equal(trashAlreadyGone(new Error(NOT_IN_TRASH)), true);
    assert.equal(trashAlreadyGone(new Error(`ERROR: ${NOT_IN_TRASH}`)), true);
    assert.equal(trashAlreadyGone(new Error("Счёт этой операции удалён — сначала верните его")), false);
    assert.equal(trashAlreadyGone(null), false);
  });

  test("двойной тап по одной строке запускает действие один раз", () => {
    const guard = createRowGuard();
    assert.equal(guard.enter("a"), true);
    assert.equal(guard.enter("a"), false);
    assert.equal(guard.busy("a"), true);
    assert.equal(guard.enter("b"), true);
    guard.leave("a");
    assert.equal(guard.enter("a"), true);
  });

  test("экран сторожит строку и не зовёт mutate с колбэками (отцепляются вторым вызовом)", () => {
    const code = readFileSync(resolve(here, "DeletedOperationsScreen.tsx"), "utf8");
    assert.match(code, /guard\.enter\(item\.id\)/);
    assert.match(code, /trashAlreadyGone\(e\)/);
    assert.ok(!/restore\.mutate\(/.test(code));
  });
});
