import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  debtIsSettled,
  debtPaidTotals,
  debtPaymentType,
  debtRemainderCents,
} from "./debt";

describe("debtPaymentType", () => {
  test("должны нам — платёж приходит доходом", () => {
    assert.equal(debtPaymentType("incoming"), "income");
  });

  test("должны мы — платёж уходит расходом", () => {
    assert.equal(debtPaymentType("outgoing"), "expense");
  });
});

describe("debtRemainderCents", () => {
  test("остаток — сумма минус уплаченное", () => {
    assert.equal(debtRemainderCents(900, 300), 60000);
  });

  test("копеечная арифметика не оставляет висящий хвост", () => {
    // 0.1 + 0.2 в плавающей точке даёт 0.30000000000000004: остаток
    // считается в центах именно поэтому.
    assert.equal(debtRemainderCents(0.3, 0.1 + 0.2), 0);
  });

  test("переплата остаётся видимой отрицательным остатком", () => {
    assert.equal(debtRemainderCents(100, 120), -2000);
  });

  test("мусор вместо числа читается как ноль, а не как NaN", () => {
    assert.equal(debtRemainderCents(Number.NaN, 50), -5000);
    assert.equal(debtRemainderCents(50, Number.NaN), 5000);
  });
});

describe("debtIsSettled", () => {
  test("платить ещё есть что — долг открыт", () => {
    assert.equal(debtIsSettled(900, 300), false);
  });

  test("ровно закрыт и переплачен — оба закрыты", () => {
    assert.equal(debtIsSettled(900, 900), true);
    assert.equal(debtIsSettled(900, 1000), true);
  });
});

describe("debtPaidTotals", () => {
  test("складывает платежи по каждому долгу", () => {
    const totals = debtPaidTotals([
      { debt_id: "a", amount: 300 },
      { debt_id: "a", amount: 200 },
      { debt_id: "b", amount: 50 },
    ]);
    assert.equal(totals.get("a"), 500);
    assert.equal(totals.get("b"), 50);
  });

  test("операции без долга проходят мимо", () => {
    const totals = debtPaidTotals([
      { debt_id: null, amount: 999 },
      { amount: 999 },
      { debt_id: "a", amount: 10 },
    ]);
    assert.equal(totals.size, 1);
    assert.equal(totals.get("a"), 10);
  });

  test("знак не важен: расход по «я должен» тоже гасит долг", () => {
    const totals = debtPaidTotals([{ debt_id: "a", amount: -300 }]);
    assert.equal(totals.get("a"), 300);
  });
});
