import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Account } from "@babun/shared/local/finance/account";
import { balanceText, mergeAccountBalances } from "./shared";

const row = (id: string, opening: number) => ({ id, opening_balance: opening }) as unknown as Account;
const balance = (account_id: string, delta: number, has_history = true) => ({
  account_id,
  delta,
  has_history,
  is_active: true,
  last_outflow_on: null,
  last_tx_on: null,
  first_tx_on: null,
});

describe("остатки счетов из строк и серверных дельт", () => {
  test("остаток = стартовый + дельта, и он назван сервером", () => {
    const [a] = mergeAccountBalances([row("a", 100)], [balance("a", 25.5)]);
    assert.equal(a.balance, 125.5);
    assert.equal(a.balance_known, true);
    assert.equal(a.has_history, true);
  });

  test("сервер строки не прислал — остаток неизвестен, а не «стартовый + 0»", () => {
    const [a] = mergeAccountBalances([row("a", 100)], []);
    assert.equal(a.balance_known, false);
    assert.equal(a.balance, 0);
    assert.equal(balanceText(a, (n) => `€${n}`), "—");
  });

  test("истории не знаем — считается, что она есть: вид счёта не меняем, счёт не «пустой»", () => {
    const [a] = mergeAccountBalances([row("a", 0)], []);
    assert.equal(a.has_history, true);
  });

  test("счёт без операций, который сервер назвал, остаётся без истории", () => {
    const [a] = mergeAccountBalances([row("a", 0)], [balance("a", 0, false)]);
    assert.equal(a.has_history, false);
    assert.equal(balanceText(a, (n) => `€${n}`), "€0");
  });
});
