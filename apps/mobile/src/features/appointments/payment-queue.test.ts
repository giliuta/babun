import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/query-core";
import { laterPaymentQueued, paymentScope } from "./payment-queue";

// Оплата и «Снять» одной записи уходят на сервер строго по очереди, и
// ответ оплаты знает, что за ним уже стоит снятие.

describe("payment queue", () => {
  test("снятие ждёт ответа оплаты той же записи", async () => {
    const qc = new QueryClient();
    const calls: string[] = [];
    let release: (v: string) => void = () => {};
    let queuedDuringFirst: boolean | null = null;

    const record = qc.getMutationCache().build(qc, {
      scope: paymentScope("a1"),
      mutationFn: () => {
        calls.push("record:start");
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
      onSuccess: () => {
        queuedDuringFirst = laterPaymentQueued(qc, "a1");
      },
    });
    const cancel = qc.getMutationCache().build(qc, {
      scope: paymentScope("a1"),
      mutationFn: async () => {
        calls.push("cancel:start");
        return "cancelled";
      },
    });

    const p1 = record.execute(undefined);
    const p2 = cancel.execute(undefined);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(calls, ["record:start"]);

    release("paid");
    await p1;
    await p2;
    assert.deepEqual(calls, ["record:start", "cancel:start"]);
    assert.equal(queuedDuringFirst, true);
    assert.equal(laterPaymentQueued(qc, "a1"), false);
  });

  test("одиночная оплата — очереди нет, ответ кладётся", async () => {
    const qc = new QueryClient();
    let queued: boolean | null = null;
    const record = qc.getMutationCache().build(qc, {
      scope: paymentScope("a1"),
      mutationFn: async () => "paid",
      onSuccess: () => {
        queued = laterPaymentQueued(qc, "a1");
      },
    });
    await record.execute(undefined);
    assert.equal(queued, false);
  });

  test("другая запись не встаёт в очередь", () => {
    assert.notEqual(paymentScope("a1")?.id, paymentScope("a2")?.id);
    assert.equal(paymentScope(null), undefined);
  });
});
