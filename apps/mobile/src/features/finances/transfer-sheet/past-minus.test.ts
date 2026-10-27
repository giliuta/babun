import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pastTransferMinus, type AccountMove } from "./past-minus";

const move = (occurred_on: string, type: string, amount: number): AccountMove => ({ occurred_on, type, amount });
const base = { name: "Cash", today: "2026-10-27" };

describe("перевод задним числом — минус в прошлом", () => {
  test("€500 пришли 20.09, перевод €500 датой 01.09 — в те дни источник в минусе", () => {
    const minus = pastTransferMinus({
      ...base,
      balance: 500,
      date: "2026-09-01",
      movesAfter: [move("2026-09-20", "income", 500)],
      amount: 500,
    });
    assert.deepEqual(minus, { name: "Cash", after: -500 });
  });

  test("деньги были уже в день перевода — молчим", () => {
    assert.equal(
      pastTransferMinus({ ...base, balance: 500, date: "2026-09-25", movesAfter: [], amount: 500 }),
      null,
    );
  });

  test("провал посередине — самый низкий день", () => {
    // 01.09 было 300; 05.09 расход 250 → 50; 10.09 доход 200 → 250 (сейчас).
    const minus = pastTransferMinus({
      ...base,
      balance: 250,
      date: "2026-09-01",
      movesAfter: [move("2026-09-05", "expense", 250), move("2026-09-10", "income", 200)],
      amount: 100,
    });
    assert.deepEqual(minus, { name: "Cash", after: -50 });
  });

  test("возврат и ноги перевода — знаками, как считает сервер", () => {
    const minus = pastTransferMinus({
      ...base,
      balance: 100,
      date: "2026-10-01",
      movesAfter: [move("2026-10-02", "refund", -40), move("2026-10-03", "transfer", 140)],
      amount: 50,
    });
    // На 01.10: 100 − (−40 + 140) = 0; 02.10: −40; 03.10: 100. Ниже всего −40 − 50.
    assert.deepEqual(minus, { name: "Cash", after: -90 });
  });

  test("сегодняшний перевод — не здесь: его сверяет обычная проверка", () => {
    assert.equal(
      pastTransferMinus({ ...base, balance: 0, date: "2026-10-27", movesAfter: [], amount: 10 }),
      null,
    );
  });
});
