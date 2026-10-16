import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { DayExtra } from "@babun/shared/local/day-extras";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { dayList } from "./day-list";

const tx = (id: string, account_id: string | null): FinanceTransaction =>
  ({ id, type: "income", amount: 10, account_id }) as FinanceTransaction;
const rec = (id: string): Appointment => ({ id }) as Appointment;
const extra = (id: string, kind: DayExtra["kind"]): DayExtra => ({ id, name: id, amount: 5, kind });

const day = {
  legacyExtras: [extra("in", "income"), extra("out", "expense")],
  incomeRows: [tx("cash-1", "cash"), tx("card-1", "card"), tx("none-1", null)],
  expenseRows: [tx("material:1", null), tx("exp-1", "cash")],
  accountPick: undefined,
  plannedRecords: [rec("p")],
  debtRecords: [rec("d")],
  ledgerLoading: false,
  dayPlanSize: 2,
};

describe("dayList", () => {
  test("a side tile lists its rows and its own legacy extras", () => {
    const l = dayList({ ...day, view: "income" });
    assert.deepEqual(l.listTx.map((x) => x.id), ["cash-1", "card-1", "none-1"]);
    assert.deepEqual(l.listExtras.map((e) => e.id), ["in"]);
    assert.deepEqual(l.listRecords, []);
  });

  test("a picked account keeps only its rows; materials have no account", () => {
    assert.deepEqual(
      dayList({ ...day, view: "income", accountPick: "card" }).listTx.map((x) => x.id),
      ["card-1"],
    );
    assert.deepEqual(
      dayList({ ...day, view: "income", accountPick: null }).listTx.map((x) => x.id),
      ["none-1"],
    );
    assert.deepEqual(
      dayList({ ...day, view: "expense", accountPick: null }).listTx.map((x) => x.id),
      [],
    );
  });

  test("debt and planned list records, no ledger rows", () => {
    assert.deepEqual(dayList({ ...day, view: "debt" }).listRecords, [rec("d")]);
    assert.deepEqual(dayList({ ...day, view: "planned" }).listRecords, [rec("p")]);
    assert.deepEqual(dayList({ ...day, view: "planned" }).listExtras, []);
  });

  test("the day plan is empty only without plan items and extras", () => {
    assert.equal(dayList({ ...day, view: "all" }).listEmpty, false);
    assert.equal(dayList({ ...day, view: "all", dayPlanSize: 0 }).listEmpty, false);
    assert.equal(dayList({ ...day, view: "all", dayPlanSize: 0, legacyExtras: [] }).listEmpty, true);
  });

  test("loading shows only for ledger tiles and the plan", () => {
    const loading = { ...day, ledgerLoading: true };
    assert.equal(dayList({ ...loading, view: "all" }).listLoading, true);
    assert.equal(dayList({ ...loading, view: "expense" }).listLoading, true);
    assert.equal(dayList({ ...loading, view: "debt" }).listLoading, false);
  });
});
