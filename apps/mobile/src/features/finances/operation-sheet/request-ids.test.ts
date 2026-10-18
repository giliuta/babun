import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createOperationRequestIds,
  operationIntentKey,
  type OperationIntentFields,
} from "./request-ids";

const base: OperationIntentFields = {
  type: "income",
  amountCents: 10000,
  categoryId: "c1",
  accountId: "a1",
  teamId: "t1",
  date: "2026-10-16",
  time: "10:00",
  notes: "заметка",
  vatMode: "none",
  vatRate: 0,
  masterId: null,
  clientId: null,
  receiptUrl: null,
  debtId: null,
};

function ids() {
  let n = 0;
  return createOperationRequestIds(() => `id-${++n}`);
}

describe("request_id операции привязан к содержимому формы", () => {
  test("повтор без правок — тот же id: серверный дедуп вернёт ту же строку", () => {
    const r = ids();
    assert.equal(r.idFor(base), r.idFor({ ...base }));
  });

  test("100 → 120 после потерянного ответа — новый id, а не отказ и не чужая сумма", () => {
    const r = ids();
    const first = r.idFor(base);
    assert.notEqual(r.idFor({ ...base, amountCents: 12000 }), first);
  });

  test("каждое поле намерения меняет id", () => {
    const patches: Partial<OperationIntentFields>[] = [
      { type: "expense" },
      { categoryId: "c2" },
      { accountId: "a2" },
      { teamId: "t2" },
      { date: "2026-10-15" },
      { time: "11:00" },
      { notes: "другая" },
      { vatMode: "exclusive", vatRate: 19 },
      { masterId: "m" },
      { clientId: "cl" },
      { receiptUrl: "r.jpg" },
      { debtId: "d" },
    ];
    for (const patch of patches) {
      const r = ids();
      const first = r.idFor(base);
      assert.notEqual(r.idFor({ ...base, ...patch }), first, JSON.stringify(patch));
    }
  });

  test("пробелы вокруг заметки намерения не меняют", () => {
    assert.equal(operationIntentKey(base), operationIntentKey({ ...base, notes: " заметка " }));
  });

  test("вернули прежнюю сумму после правки — id уже новый, старый не воскресает", () => {
    const r = ids();
    const first = r.idFor(base);
    r.idFor({ ...base, amountCents: 12000 });
    assert.notEqual(r.idFor(base), first);
  });

  test("после записи те же поля получают свежий id", () => {
    const r = ids();
    const first = r.idFor(base);
    r.done();
    assert.notEqual(r.idFor(base), first);
  });
});
