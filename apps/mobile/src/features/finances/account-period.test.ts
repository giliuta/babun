import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountPeriodClosing,
  accountPeriodRows,
  type AccountPeriodSummary,
} from "./account-period";

// Фактура живой проверки (Giliuta, июнь 2026, счёт «Карта» команды
// team-mp8379ea): net = €180. Запрещённая формула «доход − расход − возврат»
// на этих же числах даёт €280 — ровно её и ловит первый тест.
const CARD: AccountPeriodSummary = {
  opening_before: 100,
  income: 230,
  expense: -30,
  refund: -20,
  transfer_in: 0,
  transfer_out: 0,
  net: 180,
};

describe("итоги счёта за период приходят подписанными", () => {
  test("net сходится сложением, а не вычитанием расхода и возврата", () => {
    assert.equal(CARD.income + CARD.expense + CARD.refund, CARD.net);
    // Если кто-то напишет «− expense» / «− refund», получится 280.
    assert.notEqual(CARD.income - CARD.expense - CARD.refund, CARD.net);
  });

  test("остаток на конец = начало плюс все колонки подряд", () => {
    assert.equal(accountPeriodClosing(CARD), 280);
    assert.equal(
      accountPeriodClosing({
        ...CARD,
        transfer_in: 50,
        transfer_out: -70,
      }),
      260,
    );
  });

  test("перевод внутри компании не двигает net, но двигает остаток", () => {
    const collected: AccountPeriodSummary = {
      opening_before: 0,
      income: 0,
      expense: 0,
      refund: 0,
      transfer_in: 400,
      transfer_out: 0,
      net: 0,
    };
    assert.equal(collected.net, 0);
    assert.equal(accountPeriodClosing(collected), 400);
  });

  test("колонка сходится: строки складываются в остаток на конец", () => {
    const rows = accountPeriodRows(CARD);
    assert.deepEqual(
      rows.map((r) => r.key),
      ["opening", "income", "refund", "expense", "transfers", "closing"],
    );
    const movements = rows.filter(
      (r) => r.key !== "opening" && r.key !== "closing",
    );
    assert.equal(
      CARD.opening_before + movements.reduce((s, r) => s + r.value, 0),
      rows[rows.length - 1].value,
    );
  });

  test("строка возвратов не рисуется, когда возвратов не было", () => {
    const rows = accountPeriodRows({ ...CARD, refund: 0, net: 200 });
    assert.equal(rows.some((r) => r.key === "refund"), false);
    // Колонка обязана сходиться и без неё.
    assert.equal(
      rows[rows.length - 1].value,
      accountPeriodClosing({ ...CARD, refund: 0, net: 200 }),
    );
  });

  test("переводы нейтральны при любом знаке — это не доход и не расход", () => {
    const rows = accountPeriodRows({ ...CARD, transfer_in: 150 });
    const transfers = rows.find((r) => r.key === "transfers");
    assert.equal(transfers?.value, 150);
    assert.equal(transfers?.tone, "ink");
  });
});
