import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  finishPayAttempt,
  payAttemptId,
  payAttemptKey,
  type PayAttempt,
} from "./invoice-pay-request";

// ПОТЕРЯННЫЙ ОТВЕТ НЕ СТАНОВИТСЯ ВТОРЫМ ПЛАТЕЖОМ: повторный тап по тем же
// счёту и сумме несёт тот же request_id.

const here = dirname(fileURLToPath(import.meta.url));

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("попытка платежа по инвойсу записи", () => {
  const key = payAttemptKey({ invoiceId: "inv", accountId: "acc", amountCents: 1000 });

  test("повторный тап до успеха — тот же id", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const first = payAttemptId(ref, key, make);
    const second = payAttemptId(ref, key, make);
    assert.equal(first, second);
    assert.equal(first, "id-1");
  });

  test("другой счёт или сумма — другая попытка", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const first = payAttemptId(ref, key, make);
    const otherAccount = payAttemptId(
      ref,
      payAttemptKey({ invoiceId: "inv", accountId: "acc-2", amountCents: 1000 }),
      make,
    );
    const otherAmount = payAttemptId(
      ref,
      payAttemptKey({ invoiceId: "inv", accountId: "acc-2", amountCents: 500 }),
      make,
    );
    assert.equal(new Set([first, otherAccount, otherAmount]).size, 3);
  });

  test("после успеха следующий платёж по тем же данным — новый id", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const first = payAttemptId(ref, key, make);
    finishPayAttempt(ref);
    assert.notEqual(payAttemptId(ref, key, make), first);
  });

  test("хук берёт id у попытки и закрывает её только после успеха", () => {
    const hook = readFileSync(resolve(here, "use-appointment-invoice-pay.ts"), "utf8");
    assert.doesNotMatch(hook, /request_id: randomUuid\(\)/);
    assert.match(hook, /request_id: requestId,/);
    assert.match(
      hook,
      /await record\.mutateAsync\(\{[\s\S]*?\}\);\s*finishPayAttempt\(attempt\);/,
    );
  });
});
