import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { refundRemainingCents } from "./refund";

// Кап возврата уже ломался float-математикой (10 − 1.12 = 8.879999…):
// префилл предлагал кривую сумму, а вернуть ровно остаток было «нельзя».
// Тест закрепляет расчёт в центах, чтобы регрессия не вернулась молча.

describe("refundRemainingCents — кап возврата в центах", () => {
  test("остаток после частичного возврата — ровные центы, не float-хвост", () => {
    assert.equal(refundRemainingCents(10, 1.12), 888);
  });

  test("возврат ровно остатка закрывает доход в ноль: 10 − 1.12 − 8.88 = 0", () => {
    // 1.12 + 8.88 во float — 10.000000000000002: без округления в центах
    // здесь оставался бы «минус ноль» и ложный запрет.
    assert.equal(refundRemainingCents(10, 1.12 + 8.88), 0);
  });

  test("перевозвращённый доход — 0, а не отрицательный кап", () => {
    assert.equal(refundRemainingCents(10, 12), 0);
  });

  test("возвратов ещё не было — доступна вся сумма", () => {
    assert.equal(refundRemainingCents(249.99, 0), 24_999);
  });

  test("Σ возвратов ещё грузится (Infinity) — консервативный 0", () => {
    // Экран передаёт Infinity, пока данные в полёте: кнопка «Создать
    // возврат» должна прятаться, а не завышать кап.
    assert.equal(refundRemainingCents(10, Number.POSITIVE_INFINITY), 0);
  });
});
