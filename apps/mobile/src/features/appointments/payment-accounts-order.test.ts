import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PaymentAccountOption } from "./payment-accounts";
import { sortPaymentAccounts } from "./payment-accounts-order";

const acc = (id: string, name: string, position: number): PaymentAccountOption => ({
  id,
  name,
  kind: "cash",
  scope: "team",
  icon: null,
  color: null,
  position,
});

describe("плитки оплаты — в порядке страницы «Счета»", () => {
  test("перетащили карту первой — первой она и в оплате, основной не лезет вперёд", () => {
    // Сервер отдаёт основной счёт первым; порядок решает ручка.
    const fromServer = [acc("cash", "Наличные", 1), acc("card", "Карта", 0)];
    assert.deepEqual(sortPaymentAccounts(fromServer).map((a) => a.id), ["card", "cash"]);
  });

  test("одна позиция — по имени; исходный список не меняется", () => {
    const list = [acc("b", "Банк", 0), acc("a", "Альфа", 0)];
    assert.deepEqual(sortPaymentAccounts(list).map((a) => a.id), ["a", "b"]);
    assert.deepEqual(list.map((a) => a.id), ["b", "a"]);
  });
});
