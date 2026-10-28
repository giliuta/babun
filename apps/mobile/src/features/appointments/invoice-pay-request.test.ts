import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  finishPayAttempt,
  payAttempt,
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
    const first = payAttempt(ref, key, make, "2026-10-27").id;
    const second = payAttempt(ref, key, make, "2026-10-27").id;
    assert.equal(first, second);
    assert.equal(first, "id-1");
  });

  test("другой счёт или сумма — другая попытка", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const first = payAttempt(ref, key, make, "2026-10-27").id;
    const otherAccount = payAttempt(
      ref,
      payAttemptKey({ invoiceId: "inv", accountId: "acc-2", amountCents: 1000 }),
      make,
      "2026-10-27",
    ).id;
    const otherAmount = payAttempt(
      ref,
      payAttemptKey({ invoiceId: "inv", accountId: "acc-2", amountCents: 500 }),
      make,
      "2026-10-27",
    ).id;
    assert.equal(new Set([first, otherAccount, otherAmount]).size, 3);
  });

  test("после успеха следующий платёж по тем же данным — новый id", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const first = payAttempt(ref, key, make, "2026-10-27").id;
    finishPayAttempt(ref);
    assert.notEqual(payAttempt(ref, key, make, "2026-10-27").id, first);
  });

  test("повтор после полуночи несёт дату первой попытки", () => {
    const ref: { current: PayAttempt | null } = { current: null };
    const make = counter();
    const before = payAttempt(ref, key, make, "2026-10-27");
    const after = payAttempt(ref, key, make, "2026-10-28");
    assert.equal(after.id, before.id);
    assert.equal(after.occurredOn, "2026-10-27");
    finishPayAttempt(ref);
    assert.equal(payAttempt(ref, key, make, "2026-10-28").occurredOn, "2026-10-28");
  });

  test("хук берёт id у попытки и закрывает её только после успеха", () => {
    const hook = readFileSync(resolve(here, "use-appointment-invoice-pay.ts"), "utf8");
    assert.doesNotMatch(hook, /request_id: randomUuid\(\)/);
    assert.match(hook, /request_id: requestId,/);
    // Дата — попытки, а не «сегодня» на момент повтора.
    assert.match(hook, /occurred_on: occurredOn,/);
    assert.match(
      hook,
      /await record\.mutateAsync\(\{[\s\S]*?\}\);\s*finishPayAttempt\(attempt\);/,
    );
  });
});
