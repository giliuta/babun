import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { minusWarning } from "../account-alerts";
import { operationInputReason, type OperationGateInput } from "./operation-guards";

// РАСХОД В МИНУС — НЕ ЗАПРЕТ, А СЛОВА: минус на счёте разрешён всем. Новый расход, который уводит счёт ниже нуля, пишет под
// кнопкой ту же фразу, что отмена перевода, — кнопка живая.
const here = dirname(fileURLToPath(import.meta.url));

const ready: OperationGateInput = {
  online: true,
  accountsFailed: false,
  txAccountClosed: false,
  amount: "30.11",
  amountCents: 3011,
  refundedTotal: 0,
  belowRefunded: false,
  lowersWhileRefundsUnknown: false,
  dateInFuture: false,
  accountMismatch: false,
  teamId: "team-1",
  teamAccountsCount: 1,
  accountId: "cash",
  categoryId: "cat",
  receiptMissing: false,
  refundsFailed: false,
  noCategories: false,
  canCreateCategory: true,
  debtRemainderCents: null,
} as OperationGateInput;

describe("новый расход в минус", () => {
  test("форма готова, счёт уйдёт в минус — нейтральная фраза о минусе", () => {
    const minus = { name: "Cash", after: -30.11 };
    assert.deepEqual(operationInputReason({ ...ready, minus }), { text: minusWarning(minus), error: false });
  });

  test("без минуса — причины нет", () => {
    assert.equal(operationInputReason({ ...ready, minus: null }), null);
  });

  test("лист считает минус только у нового расхода", () => {
    const sheet = readFileSync(resolve(here, "../OperationSheet.tsx"), "utf8");
    assert.match(sheet, /minus: type === "expense" && !isEdit && grossCents != null \? minusAfterSpend\(acc\.selectedAccount, grossCents \/ 100\) : null/);
  });
});
