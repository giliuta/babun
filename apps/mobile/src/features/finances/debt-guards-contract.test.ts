import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ДОЛГ: будущая дата гасит кнопку сразу; оплата не больше остатка — и в форме,
// и на сервере (триггеры миграции 20261016140100).
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(here, f), "utf8");

test("форма долга гасит кнопку при будущей дате", () => {
  const draft = read("use-debt-draft.ts");
  assert.match(draft, /const dateInFuture = date > todayYmd\(\);/);
  assert.match(draft, /&& !dateInFuture;/);
});

test("форма оплаты долга знает остаток", () => {
  assert.match(read("OperationSheet.tsx"), /debtRemainderCents: debtPayment \? Math\.round\(debtPayment\.amount \* 100\) : null/);
});

test("сервер держит долг: платежи не больше долга, долг не меньше уплаченного", () => {
  const sql = read("../../../../../supabase/migrations/20261016140100_debt_payments_within_debt.sql");
  assert.match(sql, /before insert or update of amount, debt_id on public\.finance_transactions/);
  assert.match(sql, /before update of amount on public\.debts/);
  assert.match(sql, /for update;/);
  assert.match(sql, /revoke all on function public\.guard_debt_payment_total\(\) from public, anon, authenticated;/);
});
