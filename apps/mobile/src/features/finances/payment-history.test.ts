import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  paymentEvents,
  paymentEventTitle,
  paymentEventsNet,
} from "./payment-history";

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "t1",
    type: "income",
    amount: 50,
    reversal_kind: null,
    appointment_payment_kind: "settlement",
    account_id: "acc-1",
    created_at: "2026-09-06T09:38:15Z",
    ...over,
  }) as unknown as FinanceTransaction;

describe("paymentEventTitle", () => {
  test("расчёт и предоплата зовутся по-разному", () => {
    assert.equal(paymentEventTitle(tx({})), "Оплата");
    assert.equal(
      paymentEventTitle(tx({ appointment_payment_kind: "prepayment" })),
      "Предоплата",
    );
  });

  test("снятие и возврат клиенту — разные события, а не одно", () => {
    assert.equal(
      paymentEventTitle(tx({ type: "refund", reversal_kind: "not_received" })),
      "Оплата снята",
    );
    assert.equal(
      paymentEventTitle(tx({ type: "refund", reversal_kind: "client_refund" })),
      "Возврат",
    );
  });

  test("минус без причины считаем снятием, а не возвратом денег клиенту", () => {
    assert.equal(
      paymentEventTitle(tx({ type: "refund", reversal_kind: null })),
      "Оплата снята",
    );
  });
});

describe("paymentEvents", () => {
  test("порядок — от раннего к позднему, как в разговоре", () => {
    const events = paymentEvents([
      tx({ id: "b", created_at: "2026-09-06T13:01:45Z" }),
      tx({ id: "a", created_at: "2026-09-06T09:38:15Z" }),
    ]);
    assert.deepEqual(
      events.map((e) => e.id),
      ["a", "b"],
    );
  });

  test("сумма приходит без знака, направление — отдельным полем", () => {
    const [event] = paymentEvents([
      tx({ type: "refund", amount: -135, reversal_kind: "not_received" }),
    ]);
    assert.equal(event.amount, 135);
    assert.equal(event.tone, "out");
    assert.equal(event.cancelled, true);
  });

  test("чужие типы в историю платежей не попадают", () => {
    const events = paymentEvents([
      tx({ id: "e", type: "expense" }),
      tx({ id: "tr", type: "transfer" }),
      tx({ id: "ok" }),
    ]);
    assert.deepEqual(
      events.map((e) => e.id),
      ["ok"],
    );
  });
});

describe("paymentEventsNet", () => {
  test("восемь пар «внесли → сняли» дают то, что осталось", () => {
    const events = paymentEvents([
      tx({ id: "1", amount: 135, created_at: "2026-09-06T09:38:15Z" }),
      tx({
        id: "2",
        type: "refund",
        amount: -135,
        reversal_kind: "not_received",
        created_at: "2026-09-06T09:39:30Z",
      }),
      tx({ id: "3", amount: 50, created_at: "2026-09-06T12:34:07Z" }),
      tx({ id: "4", amount: 34, created_at: "2026-09-06T13:01:33Z" }),
      tx({ id: "5", amount: 44, created_at: "2026-09-06T13:01:45Z" }),
    ]);
    assert.equal(paymentEventsNet(events), 128);
  });

  test("копейки не всплывают", () => {
    const events = paymentEvents([
      tx({ id: "1", amount: 44.4 }),
      tx({ id: "2", amount: 34.4 }),
    ]);
    assert.equal(paymentEventsNet(events), 78.8);
  });
});
