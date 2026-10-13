import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Debt } from "@babun/shared/local/finance/debt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { NO_TEAM } from "../accounts-sections";
import { financeReadRules } from "../finance-read-rules";
import type { RecordRowRefs } from "../record-rows";
import {
  buildAllTimeRows,
  buildFeedRows,
  documentsFilterOnOpen,
  type AllTimeRowsInput,
  type FeedRowsInput,
} from "./feed-rows";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-06",
    time_start: "11:30",
    time_end: "13:00",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", serviceName: "A/C Cleaning" }],
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
    type: "expense",
    amount: 20,
    appointment_id: null,
    category_id: null,
    client_id: null,
    team_id: "t1",
    account_id: null,
    debt_id: null,
    notes: null,
    occurred_on: "2026-09-05",
    occurred_time: "10:00",
    source: "manual",
    ...over,
  }) as unknown as FinanceTransaction;

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: "d1",
  tenant_id: "tn",
  direction: "outgoing",
  client_id: null,
  counterparty: "Gree",
  amount: 900,
  currency: "EUR",
  category_id: null,
  note: null,
  receipt_url: null,
  occurred_on: "2026-09-02",
  occurred_time: null,
  team_id: null,
  created_at: "2026-09-02T10:00:00Z",
  ...over,
});

const refs: RecordRowRefs = {
  appointments: [appt({})],
  clients: [{ id: "c1", full_name: "Константин" }],
  services: [{ id: "s1", name: "A/C Cleaning" }],
  categories: [],
};

const feed = (over: Partial<FeedRowsInput> = {}): FeedRowsInput => ({
  access: { recordMoney: true },
  view: "all",
  query: "",
  scopedTransactions: [],
  materialRows: [],
  recordRefs: refs,
  scopedAppointments: [],
  clients: [{ id: "c1", full_name: "Константин" }],
  services: [{ id: "s1", name: "A/C Cleaning" }],
  categories: [],
  period: { from: "2026-09-01", to: "2026-09-30" },
  businessToday: "2026-09-09",
  businessNowHm: "12:00",
  scope: "t1",
  invoicedAppointments: new Set<string>(),
  invoiceDebts: [],
  debts: [],
  debtPaid: new Map(),
  ...over,
});

describe("buildFeedRows", () => {
  test("panels without a feed get no rows", () => {
    for (const view of ["accounts", "documents", "profit", "debt"] as const) {
      assert.deepEqual(buildFeedRows(feed({ view, scopedTransactions: [tx({})] })), []);
    }
  });

  test("the all feed carries expenses, record debts, manual debts and transfers, newest first", () => {
    const rows = buildFeedRows(
      feed({
        scopedTransactions: [
          tx({ id: "e1", occurred_on: "2026-09-05" }),
          tx({ id: "tr1", type: "transfer", amount: -50, occurred_on: "2026-09-07" }),
        ],
        scopedAppointments: [appt({ id: "a1", date: "2026-09-06" })],
        debts: [debt({ id: "d1", occurred_on: "2026-09-02" }), debt({ id: "old", occurred_on: "2026-08-02" })],
      }),
    );
    assert.deepEqual(
      rows.map((row) => row.date),
      ["2026-09-07", "2026-09-06", "2026-09-05", "2026-09-02"],
    );
    assert.ok(rows[0]?.key.startsWith("tr:"));
    assert.ok(rows[1]?.key.startsWith("debt:"));
    assert.ok(rows[2]?.key.startsWith("expense:"));
    assert.equal(rows[3]?.debtId, "d1");
  });

  test("income view: no expenses, debts or transfers", () => {
    const rows = buildFeedRows(
      feed({
        view: "income",
        scopedTransactions: [
          tx({ id: "i1", type: "income", amount: 80 }),
          tx({ id: "e1" }),
          tx({ id: "tr1", type: "transfer", amount: -50 }),
        ],
        scopedAppointments: [appt({})],
      }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tone, "income");
  });

  test("record money hidden — no record debts in the feed", () => {
    const rows = buildFeedRows(
      feed({ access: { recordMoney: false }, scopedAppointments: [appt({})] }),
    );
    assert.deepEqual(rows, []);
  });

  test("search filters what the row shows", () => {
    const rows = buildFeedRows(
      feed({
        query: "a/c",
        scopedAppointments: [appt({})],
        scopedTransactions: [tx({ id: "e1" })],
      }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.appointmentId, "a1");
  });
});

describe("buildAllTimeRows", () => {
  const input = (over: Partial<AllTimeRowsInput> = {}): AllTimeRowsInput => ({
    found: [],
    readRules: financeReadRules({ role: "owner", map: undefined }),
    debtTeams: new Map(),
    orphanAccounts: [],
    scope: "t1",
    accountTeam: new Map(),
    requestedClientId: undefined,
    view: "all",
    recordRefs: refs,
    ...over,
  });

  test("keeps the chip's team and drops other teams", () => {
    const rows = buildAllTimeRows(
      input({ found: [tx({ id: "mine", team_id: "t1" }), tx({ id: "theirs", team_id: "t2" })] }),
    );
    assert.deepEqual(rows.map((row) => row.txId), ["mine"]);
  });

  test("«Без команды» keeps rows on orphan accounts", () => {
    const rows = buildAllTimeRows(
      input({
        scope: NO_TEAM,
        orphanAccounts: [{ id: "orphan" }],
        found: [
          tx({ id: "on-orphan", team_id: "t2", account_id: "orphan" }),
          tx({ id: "elsewhere", team_id: "t2", account_id: "acc" }),
        ],
      }),
    );
    assert.deepEqual(rows.map((row) => row.txId), ["on-orphan"]);
  });

  test("expense view shows expenses only; the client narrows", () => {
    const found = [
      tx({ id: "e-c1", client_id: "c1" }),
      tx({ id: "e-c2", client_id: "c2" }),
      tx({ id: "i-c1", type: "income", amount: 10, client_id: "c1" }),
    ];
    const rows = buildAllTimeRows(input({ view: "expense", requestedClientId: "c1", found }));
    assert.deepEqual(rows.map((row) => row.txId), ["e-c1"]);
    assert.equal(rows[0]?.key, "expense:e-c1");
  });
});

describe("documentsFilterOnOpen", () => {
  test("keeps the tab when it has documents", () => {
    assert.equal(documentsFilterOnOpen([{ kind: "invoice" }], "invoice"), null);
  });

  test("moves to the tab that has something", () => {
    assert.equal(documentsFilterOnOpen([{ kind: "receipt" }], "invoice"), "receipt");
    assert.equal(documentsFilterOnOpen([{ kind: "invoice" }], "receipt"), "invoice");
  });

  test("nothing at all — leaves the tab alone", () => {
    assert.equal(documentsFilterOnOpen([], "receipt"), null);
  });
});
