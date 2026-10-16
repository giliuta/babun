import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { blockMoney } from "./block-status";

const apt = (over: Parameters<typeof createBlankAppointment>[0]) =>
  createBlankAppointment({ total_amount: 100, ...over });

describe("деньги записи для значка блока", () => {
  test("платить нечего — значка нет", () => {
    assert.equal(blockMoney(apt({ total_amount: 0 })), null);
    assert.equal(blockMoney(apt({ kind: "event" })), null);
    assert.equal(blockMoney(apt({ status: "cancelled" })), null);
    assert.equal(blockMoney(apt({ payment_status: "refunded" })), null);
  });
  test("не платили — «не оплачено» без способа", () => {
    assert.deepEqual(blockMoney(apt({})), { state: "unpaid", method: null });
  });
  test("аванс — частично, способ по последнему платежу", () => {
    const m = blockMoney(
      apt({
        payment_status: "partial",
        payments: [{ id: "p1", method: "cash", amount: 40, paid_at: "2026-10-15" }],
      }),
    );
    assert.deepEqual(m, { state: "partial", method: "cash" });
  });
  test("всё оплачено переводом", () => {
    const m = blockMoney(
      apt({
        payment_status: "paid",
        payments: [
          { id: "p1", method: "cash", amount: 40, paid_at: "2026-10-15" },
          { id: "p2", method: "transfer", amount: 60, paid_at: "2026-10-16" },
        ],
      }),
    );
    assert.deepEqual(m, { state: "paid", method: "transfer" });
  });
  test("раздельный платёж не врёт способом — «другое»", () => {
    const m = blockMoney(
      apt({
        payment_status: "paid",
        payments: [{ id: "p1", method: "split", amount: 100, paid_at: "2026-10-15" }],
      }),
    );
    assert.deepEqual(m, { state: "paid", method: "other" });
  });
});
