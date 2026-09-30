import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  operationPatchBaseline,
  operationTransactionPatch,
  type OperationPatchBaseline,
} from "./operation-patch";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

// Полный оверврайт правки операции перезаписывал поля, которых форма не
// касалась, — правка заметки на одном устройстве стирала счёт, поменянный
// секундой раньше на другом. Патч обязан нести только то, что человек
// действительно изменил против снимка, с которым форма открылась.

const baseline: OperationPatchBaseline = {
  amount: 100,
  category_id: "cat-1",
  master_id: null,
  client_id: null,
  team_id: "team-1",
  account_id: "acc-1",
  payment_method: "cash",
  notes: "Аренда",
  occurred_on: "2026-09-20",
  occurred_time: "10:00",
  receipt_url: null,
  vat_mode: "none",
  debt_id: null,
};

describe("operationTransactionPatch — только изменившееся", () => {
  test("форма закрыта без единой правки — патч пуст", () => {
    const patch = operationTransactionPatch({ ...baseline }, baseline);
    assert.deepEqual(patch, {});
  });

  test("поменяли только сумму — патч несёт ровно amount", () => {
    const patch = operationTransactionPatch(
      { ...baseline, amount: 150 },
      baseline,
    );
    assert.deepEqual(patch, { amount: 150 });
  });

  test("поменяли только заметку — счёт и команда в патч не попадают", () => {
    const patch = operationTransactionPatch(
      { ...baseline, notes: "Аренда, сентябрь" },
      baseline,
    );
    assert.deepEqual(patch, { notes: "Аренда, сентябрь" });
  });

  test("null в черновике и null в снимке — не различие", () => {
    const patch = operationTransactionPatch(
      { ...baseline, master_id: null },
      { ...baseline, master_id: null },
    );
    assert.deepEqual(patch, {});
  });

  test("ключа нет в черновике вовсе — поле не трогаем (не путать с null)", () => {
    const draft: Partial<OperationPatchBaseline> = { amount: 100 };
    // client_id/vat_mode и прочее форма не прислала — их не должно быть в
    // патче, даже если в базовом снимке лежит не-null значение.
    const patch = operationTransactionPatch(draft, {
      ...baseline,
      client_id: "client-9",
    });
    assert.deepEqual(patch, {});
  });

  test("null → значение читается как правка", () => {
    const patch = operationTransactionPatch(
      { ...baseline, master_id: "master-1" },
      baseline,
    );
    assert.deepEqual(patch, { master_id: "master-1" });
  });

  test("значение → null тоже правка (снятие получателя)", () => {
    const patch = operationTransactionPatch(
      { ...baseline, master_id: null },
      { ...baseline, master_id: "master-1" },
    );
    assert.deepEqual(patch, { master_id: null });
  });

  test("business_today едет только вместе со сменой occurred_on", () => {
    const sameDate = operationTransactionPatch(
      { ...baseline, amount: 150, business_today: "2026-09-24" },
      baseline,
    );
    assert.deepEqual(sameDate, { amount: 150 });

    const newDate = operationTransactionPatch(
      { ...baseline, occurred_on: "2026-09-21", business_today: "2026-09-24" },
      baseline,
    );
    assert.deepEqual(newDate, {
      occurred_on: "2026-09-21",
      business_today: "2026-09-24",
    });
  });

  test("несколько полей разом — патч несёт все и только их", () => {
    const patch = operationTransactionPatch(
      { ...baseline, amount: 200, category_id: "cat-2", notes: null },
      baseline,
    );
    assert.deepEqual(patch, { amount: 200, category_id: "cat-2", notes: null });
  });
});

describe("operationPatchBaseline — снимок из строки леджера", () => {
  test("берёт поля один в один, без пересчёта", () => {
    const tx = {
      amount: 42,
      category_id: "cat-1",
      master_id: null,
      client_id: "client-1",
      team_id: "team-1",
      account_id: "acc-1",
      payment_method: "card",
      notes: null,
      occurred_on: "2026-09-24",
      occurred_time: null,
      receipt_url: "receipts/x.jpg",
      vat_mode: "inclusive",
      debt_id: null,
    } as unknown as FinanceTransaction;
    assert.deepEqual(operationPatchBaseline(tx), {
      amount: 42,
      category_id: "cat-1",
      master_id: null,
      client_id: "client-1",
      team_id: "team-1",
      account_id: "acc-1",
      payment_method: "card",
      notes: null,
      occurred_on: "2026-09-24",
      occurred_time: null,
      receipt_url: "receipts/x.jpg",
      vat_mode: "inclusive",
      debt_id: null,
    });
  });
});

describe("operationPatchBaseline — режим НДС старой строки", () => {
  const row = (vat_mode: string | null, vat_amount: number) =>
    ({
      amount: 121,
      category_id: null,
      master_id: null,
      client_id: null,
      team_id: null,
      account_id: null,
      payment_method: "cash",
      notes: null,
      occurred_on: "2026-09-20",
      occurred_time: null,
      receipt_url: null,
      vat_mode,
      vat_amount,
      debt_id: null,
    }) as unknown as FinanceTransaction;

  test("пустой режим с налогом — снимок «внутри», как показала форма", () => {
    const base = operationPatchBaseline(row(null, 21));
    assert.equal(base.vat_mode, "inclusive");
    // Сохранили без правок — режим в патч не попал, колонка остаётся пустой.
    assert.deepEqual(operationTransactionPatch({ ...base, vat_mode: "inclusive" }, base), {});
  });

  test("пустой режим без налога — снимок «без НДС»", () => {
    const base = operationPatchBaseline(row(null, 0));
    assert.deepEqual(operationTransactionPatch({ ...base, vat_mode: "none" }, base), {});
  });

  test("режим сменили руками — уходит", () => {
    const base = operationPatchBaseline(row(null, 21));
    assert.deepEqual(operationTransactionPatch({ ...base, vat_mode: "exclusive" }, base), {
      vat_mode: "exclusive",
    });
  });
});
