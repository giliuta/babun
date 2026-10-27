import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import type { ClosableAccount } from "../close-decision";
import {
  accountEditParam,
  accountRowMark,
  clearSettledMoves,
  groupBalanceTotal,
  hideDecision,
  hideDecisionAfterTransfer,
  presetTeamFor,
  trashDecision,
  trashDecisionAfterTransfer,
} from "./page-rules";

const here = dirname(fileURLToPath(import.meta.url));

type Row = ClosableAccount & { name: string };

function account(patch: Partial<Row> & { id: string }): Row {
  return {
    name: patch.id,
    balance: 0,
    has_history: true,
    is_active: true,
    brigade_id: "t-1",
    ...patch,
  };
}

describe("«Скрыть» на странице «Счета»", () => {
  test("счёт без операций и без денег закрывается, а не удаляется", () => {
    const typo = account({ id: "typo", has_history: false });
    const decision = hideDecision(typo, [typo, account({ id: "cash" })]);
    assert.deepEqual(decision, { kind: "close" });
  });

  test("остаток на начало без операций ведёт в перевод, а не в удаление", () => {
    const fresh = account({ id: "safe", has_history: false, balance: 500 });
    const decision = hideDecision(fresh, [fresh, account({ id: "cash" })]);
    assert.deepEqual(decision, { kind: "transfer", direction: "out", amount: 500 });
  });

  test("минус без денег в компании — объяснение, а не вопрос", () => {
    const debt = account({ id: "debt", balance: -40 });
    assert.deepEqual(hideDecision(debt, [debt, account({ id: "zero" })]), {
      kind: "explain",
    });
  });

  test("после перевода: остаток не сдвинулся — молчим, стал нулём — закрываем", () => {
    const before = account({ id: "cash", balance: 120, has_history: false });
    const unchanged = [before, account({ id: "card" })];
    assert.equal(hideDecisionAfterTransfer(before, unchanged), null);
    assert.equal(hideDecisionAfterTransfer(before, undefined), null);

    const moved = [
      account({ id: "cash", balance: 0, has_history: false }),
      account({ id: "card", balance: 120 }),
    ];
    const next = hideDecisionAfterTransfer(before, moved);
    assert.equal(next?.account.id, "cash");
    assert.deepEqual(next?.decision, { kind: "close" });
  });
});

describe("счёт из адреса `?edit=`", () => {
  const id = "3f2c1e9a-7b4d-4c1e-9a8b-0d2e4f6a8c10";

  test("uuid открывает шторку, первый из повторённых ключей", () => {
    assert.equal(accountEditParam(id), id);
    assert.equal(accountEditParam(` ${id.toUpperCase()} `), id.toUpperCase());
    assert.equal(accountEditParam([id, "другой"]), id);
  });

  test("не uuid — шторка не открывается", () => {
    for (const bad of [undefined, "", "new", id.slice(0, 20), `${id}x`, ["new", id]]) {
      assert.equal(accountEditParam(bad), null, String(bad));
    }
  });
});

describe("команда нового счёта", () => {
  test("единственная живая команда — ей, иначе выбор за шторкой", () => {
    assert.equal(
      presetTeamFor([
        { id: "t-1", is_active: true },
        { id: "t-old", is_active: false },
      ]),
      "t-1",
    );
    assert.equal(
      presetTeamFor([
        { id: "t-1", is_active: true },
        { id: "t-2", is_active: true },
      ]),
      null,
    );
    assert.equal(presetTeamFor([]), null);
  });
});

describe("тихая метка строки счёта", () => {
  test("счёт вне оплаты записи говорит об этом; «Основного» больше нет", () => {
    assert.equal(accountRowMark({ show_in_payments: false }), "Не в оплате");
    assert.equal(accountRowMark({ show_in_payments: true }), null);
    // Скрытый счёт — «Скрыт», а не «Не в оплате»: в оплате
    // его не бывает никогда, главное про него — что он спрятан.
    assert.equal(accountRowMark({ show_in_payments: false, is_hidden: true }), "Скрыт");
  });
});

describe("«Удалить» на странице «Счета» (владелец 03.10)", () => {
  test("пустой счёт — вопрос об удалении, с операциями или без", () => {
    const typo = account({ id: "typo", has_history: false });
    const used = account({ id: "used" });
    assert.deepEqual(trashDecision(typo, [typo, used]), { kind: "trash" });
    assert.deepEqual(trashDecision(used, [typo, used]), { kind: "trash" });
  });

  test("закрытый счёт удаляется сразу — у него всегда ноль", () => {
    const closed = account({ id: "closed", is_active: false });
    assert.deepEqual(trashDecision(closed, [account({ id: "cash" })]), { kind: "trash" });
  });

  test("деньги на счёте — сначала перевод, как у «Скрыть»", () => {
    const kasa = account({ id: "kasa", balance: 445 });
    assert.deepEqual(trashDecision(kasa, [kasa, account({ id: "bank" })]), {
      kind: "transfer",
      direction: "out",
      amount: 445,
    });
  });

  test("после перевода всего остатка — снова вопрос об удалении", () => {
    const before = account({ id: "kasa", balance: 445 });
    const next = trashDecisionAfterTransfer(before, [account({ id: "kasa", balance: 0 }), account({ id: "bank", balance: 445 })]);
    assert.deepEqual(next?.decision, { kind: "trash" });
  });
});

describe("подытог группы счетов", () => {
  const row = (balance: number, patch: Partial<{ balance_known: boolean; is_active: boolean; is_hidden: boolean }> = {}) => ({
    balance,
    balance_known: true,
    is_active: true,
    is_hidden: false,
    ...patch,
  });

  test("сумма всех строк группы, скрытых и закрытых тоже, — в копейках", () => {
    assert.equal(groupBalanceTotal([row(0.1), row(0.2), row(50, { is_hidden: true }), row(9, { is_active: false })]), 59.3);
    // Review, CoolAir: Cash €0 + скрытый Test QA €209,75 — подпись группы €209,75, а не €0.
    assert.equal(groupBalanceTotal([row(0), row(209.75, { is_hidden: true })]), 209.75);
  });

  test("остаток хоть одного счёта неизвестен — подытога нет, а не «€0»", () => {
    assert.equal(groupBalanceTotal([row(10), row(0, { balance_known: false })]), null);
  });

  test("неизвестный остаток скрытого счёта — тоже прочерк: строка на странице", () => {
    assert.equal(
      groupBalanceTotal([row(10), row(0, { balance_known: false, is_hidden: true })]),
      null,
    );
  });
});

describe("оптимистичный порядок счетов после ответа", () => {
  test("после ответа позиции снимаются: свежие с сервера не перекрыты старыми", () => {
    const latest = new Map([["a", 1], ["b", 1]]);
    assert.deepEqual(clearSettledMoves({ a: 0, b: 1 }, ["a", "b"], latest, 1), {});
  });

  test("счёт, переставленный заново, пока шёл первый запрос, свою позицию сохраняет", () => {
    const latest = new Map([["a", 2], ["b", 1]]);
    assert.deepEqual(clearSettledMoves({ a: 1, b: 0 }, ["a", "b"], latest, 1), { a: 1 });
  });

  test("чужие счета не затрагиваются", () => {
    const latest = new Map([["a", 1]]);
    assert.deepEqual(clearSettledMoves({ a: 0, z: 5 }, ["a"], latest, 1), { z: 5 });
  });
});

describe("страница «Счета»: порядок записывается до конца и перечитывается", () => {
  const read = (path: string) => readFileSync(resolve(here, path), "utf8");
  test("мутация ждёт все записи и перечитывает при любом исходе", () => {
    const code = read("../accounts/mutations.ts");
    assert.match(code, /Promise\.allSettled\(/);
    assert.match(code, /onSettled: \(\) => invalidateAccounts\(qc\)/);
  });
  test("экран снимает позиции после перечитывания, а не вслепую", () => {
    const code = read("../../../../app/accounts/settings.tsx");
    assert.match(code, /accountsQuery\.refetch\(\)/);
    assert.match(code, /clearSettledMoves\(/);
    assert.ok(!/setMoved\(\{\}\)/.test(code), "сброс всех позиций разом снова не нужен");
  });
});
