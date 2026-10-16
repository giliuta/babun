import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  REFUNDS_FAILED_REASON,
  NO_CATEGORIES_REASON,
  REFUNDS_LOADING_REASON,
  operationCanSave,
  operationInputReason,
  type OperationGateInput,
} from "./operation-guards";

const here = dirname(fileURLToPath(import.meta.url));

const gate: OperationGateInput = {
  online: true,
  accountsFailed: false,
  txAccountClosed: false,
  amount: "10",
  amountCents: 1000,
  refundedTotal: Number.POSITIVE_INFINITY,
  belowRefunded: false,
  lowersWhileRefundsUnknown: true,
  dateInFuture: false,
  accountMismatch: false,
  teamId: "t1",
  teamAccountsCount: 1,
  accountId: "a1",
  categoryId: "c1",
  receiptMissing: false,
  categoryName: "Fuel",
};

describe("возвраты не известны: грузятся или упали", () => {
  test("пока едет — спокойное «загружаются», без повтора", () => {
    const reason = operationInputReason(gate);
    assert.equal(reason?.text, REFUNDS_LOADING_REASON);
    assert.equal(reason?.error, false);
    assert.equal(reason?.retry, undefined);
  });

  test("упали — честная причина-ошибка, которую можно тапнуть, чтобы повторить", () => {
    const reason = operationInputReason({ ...gate, refundsFailed: true });
    assert.equal(reason?.text, REFUNDS_FAILED_REASON);
    assert.equal(reason?.error, true);
    assert.equal(reason?.retry, true);
  });

  test("кнопка в обоих случаях погашена", () => {
    assert.equal(operationCanSave({ ...gate, canWrite: true, busy: false }), false);
    assert.equal(operationCanSave({ ...gate, refundsFailed: true, canWrite: true, busy: false }), false);
  });
});

describe("экран передаёт форме ошибку Σ возвратов и повтор", () => {
  const sheets = readFileSync(resolve(here, "../home/HomeSheets.tsx"), "utf8");
  test("лист правки и витрина операции получают признак ошибки и повтор", () => {
    assert.match(sheets, /refundsFailed=\{refundTotalsFailed\}/);
    assert.match(sheets, /onRetryRefunds=\{/);
    assert.match(sheets, /onRetryRefundTotals=\{/);
  });
});

describe("команда без категорий", () => {
  const base: OperationGateInput = {
    ...gate,
    refundedTotal: 0,
    lowersWhileRefundsUnknown: false,
    categoryId: null,
  };

  test("партнёру выбирать нечего — причина называет выход, а не невыполнимое «выберите»", () => {
    const reason = operationInputReason({ ...base, noCategories: true, canCreateCategory: false });
    assert.equal(reason?.text, NO_CATEGORIES_REASON);
  });

  test("владелец завести категорию может — прежняя причина", () => {
    const reason = operationInputReason({ ...base, noCategories: true, canCreateCategory: true });
    assert.equal(reason?.text, "Выберите категорию операции");
  });

  test("категории есть — прежняя причина, и у партнёра тоже", () => {
    const reason = operationInputReason({ ...base, noCategories: false, canCreateCategory: false });
    assert.equal(reason?.text, "Выберите категорию операции");
  });
});
