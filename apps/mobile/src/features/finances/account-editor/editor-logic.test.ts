import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClosableAccount } from "../close-decision";
import {
  accountEditHref,
  editorView,
  stepAfterAnswer,
  stepAfterTransfer,
  teamControl,
} from "./editor-logic";

const acc = (over: Partial<ClosableAccount> & { id: string }): ClosableAccount => ({
  balance: 0,
  has_history: true,
  is_active: true,
  is_primary: false,
  brigade_id: "t1",
  ...over,
});

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

describe("команда счёта в листе", () => {
  test("счёт без команды отдают команде даже с историей", () => {
    assert.equal(teamControl({ brigade_id: null, has_history: true }, ["t1"]), "hand-over");
    assert.equal(teamControl({ brigade_id: null, has_history: false }, []), "fixed");
  });

  test("с историей команда заморожена", () => {
    assert.equal(teamControl({ brigade_id: "t1", has_history: true }, ["t1", "t2"]), "fixed");
  });

  test("без истории выбирают, только если есть другая живая команда", () => {
    assert.equal(teamControl({ brigade_id: "t1", has_history: false }, ["t1", "t2"]), "choose");
    assert.equal(teamControl({ brigade_id: "t1", has_history: false }, ["t1"]), "fixed");
    // Команда счёта в архиве, живая одна — перенести в неё можно.
    assert.equal(teamControl({ brigade_id: "old", has_history: false }, ["t1"]), "choose");
  });
});

describe("после ответа на вопрос о закрытии", () => {
  test("любой отказ возвращает лист", () => {
    assert.equal(stepAfterAnswer({ kind: "delete" }, false), "return");
    assert.equal(stepAfterAnswer({ kind: "close", successor: null }, false), "return");
    assert.equal(
      stepAfterAnswer({ kind: "transfer", direction: "out", amount: 5 }, false),
      "return",
    );
    assert.equal(stepAfterAnswer({ kind: "explain" }, true), "return");
  });

  test("согласие делает то, о чём спрашивали", () => {
    assert.equal(stepAfterAnswer({ kind: "delete" }, true), "delete");
    assert.equal(stepAfterAnswer({ kind: "close", successor: null }, true), "close");
    assert.equal(
      stepAfterAnswer({ kind: "transfer", direction: "in", amount: 5 }, true),
      "transfer",
    );
  });
});

describe("после перевода ради закрытия", () => {
  const before = acc({ id: "a", balance: 50 });

  test("остаток ушёл — спрашиваем снова по свежему", () => {
    const fresh = [acc({ id: "a", balance: 0 }), acc({ id: "b", balance: 50 })];
    const step = stepAfterTransfer(before, fresh);
    assert.equal(step.kind, "ask");
    if (step.kind === "ask") {
      assert.equal(step.account.balance, 0);
      assert.equal(step.decision.kind, "close");
    }
  });

  test("перевод отменили или данных нет — лист возвращается", () => {
    assert.deepEqual(stepAfterTransfer(before, [acc({ id: "a", balance: 50 })]), { kind: "return" });
    assert.deepEqual(stepAfterTransfer(before, undefined), { kind: "return" });
  });
});
