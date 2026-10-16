import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { financeReadRules, type FinanceReadRules } from "../finance-read-rules";
import { homeTotals, materialSummaryFor, previousProfit, type HomeTotalsInput } from "./home-totals";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-06",
    time_start: "11:30",
    time_end: "13:00",
    status: "completed",
    service_ids: [],
    services: [],
    total_amount: 135,
    payment_status: "partial",
    prepaid_amount: 0,
    paid_amount: 100,
    payments: [{ id: "p1", amount: 100, method: "cash", paid_at: "2026-09-06T12:00:00Z" }],
    ...over,
  }) as unknown as Appointment;

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx1",
    type: "income",
    amount: 50,
    team_id: "t1",
    client_id: null,
    account_id: null,
    debt_id: null,
    occurred_on: "2026-09-06",
    ...over,
  }) as unknown as FinanceTransaction;

const base = (over: Partial<HomeTotalsInput> = {}): HomeTotalsInput => ({
  access: { recordMoney: true },
  scopedTransactions: [],
  scopedAppointments: [],
  invoicedAppointments: new Set<string>(),
  businessToday: "2026-09-09",
  businessNowHm: "12:00",
  period: { from: "2026-09-01", to: "2026-09-30" },
  scope: "t1",
  materialAmount: 0,
  manualIncomingDebt: 0,
  invoiceDebts: [],
  ...over,
});

describe("homeTotals", () => {
  test("income nets refunds, expense adds materials, profit is the difference", () => {
    const totals = homeTotals(
      base({
        scopedTransactions: [
          tx({ id: "i", type: "income", amount: 200 }),
          tx({ id: "r", type: "refund", amount: 30 }),
          tx({ id: "e", type: "expense", amount: 40 }),
          tx({ id: "tr", type: "transfer", amount: -500 }),
        ],
        materialAmount: 10,
      }),
    );
    assert.deepEqual(totals, { income: 170, expense: 50, profit: 120, debt: 0 });
  });

  test("debt = unpaid past records of the chip + manual incoming + invoice rests", () => {
    const totals = homeTotals(
      base({
        scopedAppointments: [
          appt({ id: "owed" }),
          appt({ id: "cancelled", status: "cancelled" }),
          appt({ id: "invoiced" }),
          appt({ id: "other-team", team_id: "t2" }),
          appt({ id: "out-of-period", date: "2026-08-31" }),
          appt({ id: "later-today", status: "scheduled", date: "2026-09-09", time_end: "15:00" }),
        ],
        invoicedAppointments: new Set(["invoiced"]),
        manualIncomingDebt: 7,
        invoiceDebts: [{ amount: 3 }],
      }),
    );
    assert.equal(totals.debt, 35 + 7 + 3);
  });

  test("record money hidden — records add no debt", () => {
    const totals = homeTotals(
      base({ access: { recordMoney: false }, scopedAppointments: [appt({})] }),
    );
    assert.equal(totals.debt, 0);
  });
});

describe("materialSummaryFor", () => {
  test("record money hidden — zeros, not a made-up number", () => {
    const summary = materialSummaryFor(
      { recordMoney: false },
      [appt({})],
      [],
      { from: "2026-09-01", to: "2026-09-30" },
      "t1",
    );
    assert.equal(summary.amount, 0);
    assert.equal(summary.appointmentCount, 0);
    assert.equal(summary.byService.size, 0);
  });
});

describe("previousProfit", () => {
  const owner = financeReadRules({ role: "owner", map: undefined });

  test("money of the previous range from the team rows, narrowed to the client", () => {
    const result = previousProfit({
      prevTeamRows: [
        tx({ id: "i1", type: "income", amount: 100, client_id: "c1" }),
        tx({ id: "i2", type: "income", amount: 60, client_id: "c2" }),
        tx({ id: "e1", type: "expense", amount: 25, client_id: "c1" }),
      ],
      prevCompanyRows: [],
      scope: "t1",
      accountTeam: new Map(),
      readRules: owner,
      debtTeams: new Map(),
      requestedClientId: "c1",
      scopedAppointments: [],
      services: [],
      prevRange: { from: "2026-08-01", to: "2026-08-31" },
      recordMoney: true,
    });
    assert.equal(result.income, 100);
    assert.equal(result.expense, 25);
    assert.equal(result.profit, 75);
    assert.equal(result.from, "2026-08-01");
    assert.equal(result.to, "2026-08-31");
    assert.equal(result.materialCost, 0);
    assert.deepEqual(result.transactions.map((t) => t.id), ["i1", "e1"]);
  });

  test("partner sees only readable sides", () => {
    const incomeOnly: FinanceReadRules = {
      owner: false,
      txReadable: (row) => row.type !== "expense",
      debtReadable: () => true,
      documentReadable: () => true,
      allReceipts: false,
    };
    const result = previousProfit({
      prevTeamRows: [
        tx({ id: "i1", type: "income", amount: 100 }),
        tx({ id: "e1", type: "expense", amount: 25 }),
      ],
      prevCompanyRows: [],
      scope: "t1",
      accountTeam: new Map(),
      readRules: incomeOnly,
      debtTeams: new Map(),
      requestedClientId: undefined,
      scopedAppointments: [],
      services: [],
      prevRange: { from: "2026-08-01", to: "2026-08-31" },
      recordMoney: true,
    });
    assert.equal(result.expense, 0);
    assert.deepEqual(result.transactions.map((t) => t.id), ["i1"]);
  });
});
