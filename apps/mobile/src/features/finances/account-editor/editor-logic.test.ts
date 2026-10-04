import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountEditHref,
  editorView,
  stepAfterAnswer,
} from "./editor-logic";


describe("адрес правки счёта", () => {
  test("страница «Счета» с открытым листом, id экранируется", () => {
    assert.equal(String(accountEditHref("abc")), "/accounts/settings?edit=abc");
    assert.equal(String(accountEditHref("a&b=c")), "/accounts/settings?edit=a%26b%3Dc");
  });
});

describe("что показывает лист правки", () => {
  const list = [{ id: "a" }];

  test("данных нет: ошибка сильнее сети, без сети — не спиннер", () => {
    assert.deepEqual(
      editorView({ accountId: "a", accounts: undefined, error: new Error("boom"), online: false }),
      { kind: "failed", message: "boom" },
    );
    assert.deepEqual(
      editorView({ accountId: "a", accounts: undefined, error: null, online: true }),
      { kind: "loading" },
    );
    assert.deepEqual(
      editorView({ accountId: "a", accounts: undefined, error: null, online: false }),
      { kind: "offline" },
    );
  });

  test("данные есть: счёт найден или его больше нет", () => {
    assert.deepEqual(
      editorView({ accountId: "a", accounts: list, error: null, online: true }),
      { kind: "edit", account: { id: "a" } },
    );
    assert.deepEqual(
      editorView({ accountId: "x", accounts: list, error: new Error("stale"), online: true }),
      { kind: "gone" },
    );
  });
});

describe("после ответа на вопрос о закрытии", () => {
  test("любой отказ возвращает лист", () => {
    assert.equal(stepAfterAnswer({ kind: "delete" }, false), "return");
    assert.equal(stepAfterAnswer({ kind: "close" }, false), "return");
    assert.equal(
      stepAfterAnswer({ kind: "transfer", direction: "out", amount: 5 }, false),
      "return",
    );
    assert.equal(stepAfterAnswer({ kind: "explain" }, true), "return");
  });

  test("согласие делает то, о чём спрашивали", () => {
    assert.equal(stepAfterAnswer({ kind: "delete" }, true), "delete");
    assert.equal(stepAfterAnswer({ kind: "close" }, true), "close");
    // «Удалить счёт» (03.10): согласие уводит в «Удалённые счета», отказ —
    // возвращает лист, как у любого другого вопроса.
    assert.equal(stepAfterAnswer({ kind: "trash" }, true), "trash");
    assert.equal(stepAfterAnswer({ kind: "trash" }, false), "return");
    assert.equal(
      stepAfterAnswer({ kind: "transfer", direction: "in", amount: 5 }, true),
      "transfer",
    );
  });
});
