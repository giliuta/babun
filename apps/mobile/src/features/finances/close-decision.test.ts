import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  closeDecision,
  closeDecisionAfterTransfer,
  type ClosableAccount,
} from "./close-decision";

const acc = (over: Partial<ClosableAccount> & { id: string }): ClosableAccount => ({
  balance: 0,
  has_history: true,
  is_active: true,
  is_primary: false,
  brigade_id: "t1",
  ...over,
});

describe("закрытие счёта", () => {
  test("без операций счёт удаляется, даже с остатком на начало", () => {
    const a = acc({ id: "a", has_history: false, balance: 500 });
    assert.deepEqual(closeDecision(a, [a]), { kind: "delete" });
  });

  test("плюс уводится с счёта, если есть другой открытый счёт", () => {
    const a = acc({ id: "a", balance: 50 });
    const b = acc({ id: "b" });
    assert.deepEqual(closeDecision(a, [a, b]), {
      kind: "transfer",
      direction: "out",
      amount: 50,
    });
  });

  test("плюс на единственном счёте и закрытый сосед — объяснение", () => {
    const a = acc({ id: "a", balance: 50 });
    const closed = acc({ id: "c", is_active: false, balance: 900 });
    assert.deepEqual(closeDecision(a, [a, closed]), { kind: "explain" });
  });

  test("минус пополняется только со счёта, где деньги есть", () => {
    const a = acc({ id: "a", balance: -30 });
    const empty = acc({ id: "b", balance: 0 });
    assert.deepEqual(closeDecision(a, [a, empty]), { kind: "explain" });
    const rich = acc({ id: "c", balance: 100 });
    assert.deepEqual(closeDecision(a, [a, empty, rich]), {
      kind: "transfer",
      direction: "in",
      amount: 30,
    });
  });

  test("ноль закрывается, основной переходит живому счёту своей команды", () => {
    const a = acc({ id: "a", is_primary: true });
    const otherTeam = acc({ id: "x", brigade_id: "t2" });
    const closed = acc({ id: "c", is_active: false });
    const heir = acc({ id: "h" });
    assert.deepEqual(closeDecision(a, [a, otherTeam, closed, heir]), {
      kind: "close",
      successor: heir,
    });
    const plain = acc({ id: "p" });
    assert.deepEqual(closeDecision(plain, [plain, heir]), {
      kind: "close",
      successor: null,
    });
  });
});

describe("вопрос после перевода ради закрытия", () => {
  test("решает по свежему остатку, а не по тому, что был до перевода", () => {
    const before = acc({ id: "a", balance: 50 });
    const b = acc({ id: "b", balance: 10 });
    const fresh = [acc({ id: "a", balance: 0 }), acc({ id: "b", balance: 60 })];
    const next = closeDecisionAfterTransfer(before, fresh);
    assert.equal(next?.decision.kind, "close");
    assert.equal(next?.account.balance, 0);
    // Для сравнения: по старым данным вышел бы тот же вопрос про перевод.
    assert.equal(closeDecision(before, [before, b]).kind, "transfer");
  });

  test("перевели часть — спрашивает про остаток, который остался", () => {
    const before = acc({ id: "a", balance: 50 });
    const fresh = [acc({ id: "a", balance: 20 }), acc({ id: "b", balance: 30 })];
    assert.deepEqual(closeDecisionAfterTransfer(before, fresh)?.decision, {
      kind: "transfer",
      direction: "out",
      amount: 20,
    });
  });

  test("минус пополнили до нуля — закрывает", () => {
    const before = acc({ id: "a", balance: -30 });
    const fresh = [acc({ id: "a", balance: 0 }), acc({ id: "b", balance: 70 })];
    assert.equal(closeDecisionAfterTransfer(before, fresh)?.decision.kind, "close");
  });

  test("лист закрыли, не переведя, — второй раз не спрашивает", () => {
    const before = acc({ id: "a", balance: 50 });
    const fresh = [acc({ id: "a", balance: 50 }), acc({ id: "b" })];
    assert.equal(closeDecisionAfterTransfer(before, fresh), null);
  });

  test("свежих данных нет, счёт исчез или уже закрыт — не спрашивает", () => {
    const before = acc({ id: "a", balance: 50 });
    assert.equal(closeDecisionAfterTransfer(before, undefined), null);
    assert.equal(closeDecisionAfterTransfer(before, [acc({ id: "b" })]), null);
    assert.equal(
      closeDecisionAfterTransfer(before, [acc({ id: "a", is_active: false })]),
      null,
    );
  });
});
