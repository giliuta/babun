import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calculateInvoiceSettlement } from "./invoice-ledger";

// ИНВОЙС ПО ЗАПИСИ УЧИТЫВАЕТ ДЕНЬГИ, УЖЕ ПРИНЯТЫЕ ЗАПИСЬЮ. Работа одна:
// предоплата €260 наличными, инвойс €300 — «Получено €260 · К оплате €40».
const invoice = { status: "issued" as const, total: 300, credited_amount: 0 };
const pay = (amount: number, type: "income" | "refund" = "income") => ({
  id: `p${amount}${type}`,
  invoice_id: "i1",
  type,
  amount,
  account_id: null,
  payment_method: "cash",
  occurred_on: "2026-10-08",
  refund_of_id: null,
  notes: null,
  created_at: "2026-10-08T10:00:00Z",
});

describe("остаток инвойса с деньгами записи", () => {
  test("Review: €260 записью, инвойс €300 — получено 260, к оплате 40", () => {
    const s = calculateInvoiceSettlement(invoice, [], 260);
    assert.equal(s.paid, 260);
    assert.equal(s.fromAppointment, 260);
    assert.equal(s.remaining, 40);
    assert.equal(s.isPartial, true);
    assert.equal(s.isPaid, false);
  });

  test("запись закрыла всю сумму — инвойс оплачен", () => {
    const s = calculateInvoiceSettlement(invoice, [], 300);
    assert.equal(s.remaining, 0);
    assert.equal(s.isPaid, true);
  });

  test("деньги записи и платёж инвойса складываются, но не больше суммы", () => {
    const s = calculateInvoiceSettlement(invoice, [pay(100)], 260);
    assert.equal(s.paid, 300);
    assert.equal(s.fromAppointment, 200);
    assert.equal(s.remaining, 0);
    // Переплата — только деньгами самого инвойса: возвращать с инвойса нечего.
    assert.equal(s.overpaid, 0);
  });

  test("без денег записи — прежний расчёт", () => {
    const s = calculateInvoiceSettlement(invoice, [pay(100)]);
    assert.equal(s.paid, 100);
    assert.equal(s.fromAppointment, 0);
    assert.equal(s.remaining, 200);
  });

  test("закрытый инвойс денег не ждёт и с деньгами записи", () => {
    const s = calculateInvoiceSettlement({ ...invoice, status: "cancelled" }, [], 260);
    assert.equal(s.remaining, 0);
    assert.equal(s.isPaid, false);
  });
});
