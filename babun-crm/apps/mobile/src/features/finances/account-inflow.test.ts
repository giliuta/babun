import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  breakdownAccountInflowByTeam,
  type InflowAccountRef,
} from "./account-inflow";

const COMPANY_ACC = "acc-company";
const TEAM_A_ACC = "acc-team-a";
const TEAM_B_ACC = "acc-team-b";

const ACCOUNTS: InflowAccountRef[] = [
  { id: COMPANY_ACC, brigade_id: null },
  { id: TEAM_A_ACC, brigade_id: "team-a" },
  { id: TEAM_B_ACC, brigade_id: "team-b" },
];

let seq = 0;
function tx(partial: Partial<FinanceTransaction>): FinanceTransaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    tenant_id: "t",
    type: "income",
    amount: 0,
    currency: "EUR",
    category_id: null,
    account_id: COMPANY_ACC,
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: null,
    master_id: null,
    payment_method: "cash",
    notes: null,
    occurred_on: "2026-07-15",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: null,
    refund_of_id: null,
    source: "manual",
    created_at: "2026-07-15T10:00:00Z",
    updated_at: "2026-07-15T10:00:00Z",
    created_by: null,
    ...partial,
  };
}

describe("breakdownAccountInflowByTeam", () => {
  test("splits direct income by team and method, netting refunds to the originator", () => {
    const txs = [
      tx({ type: "income", amount: 100, team_id: "team-a", payment_method: "cash" }),
      tx({ type: "income", amount: 50, team_id: "team-a", payment_method: "card" }),
      tx({ type: "income", amount: 80, team_id: "team-b", payment_method: "cash" }),
      // Возврат 30 из наличных team-a (БД хранит refund отрицательным).
      tx({ type: "refund", amount: -30, team_id: "team-a", payment_method: "cash" }),
    ];
    const b = breakdownAccountInflowByTeam(COMPANY_ACC, txs, ACCOUNTS);
    assert.equal((b.direct).length, 2);
    const teamA = b.direct.find((r) => r.teamId === "team-a");
    assert.equal(teamA?.total, 120);
    assert.deepEqual(teamA?.byMethod, { cash: 70, card: 50 });
    const teamB = b.direct.find((r) => r.teamId === "team-b");
    assert.equal(teamB?.total, 80);
    assert.equal(b.total, 200);
  });

  test("keeps an orphan row for company-level income without a team", () => {
    const txs = [
      tx({ type: "income", amount: 40, team_id: null, payment_method: "transfer" }),
    ];
    const b = breakdownAccountInflowByTeam(COMPANY_ACC, txs, ACCOUNTS);
    assert.deepEqual(b.direct, [
      { teamId: null, byMethod: { transfer: 40 }, total: 40 },
    ]);
  });

  test("attributes collections to the source account's team via transfer_group_id", () => {
    const txs = [
      // Инкассация налички team-a на бизнес-карту: две ноги одной группы.
      tx({
        type: "transfer", amount: -200, account_id: TEAM_A_ACC,
        team_id: "team-a", payment_method: null, transfer_group_id: "g1",
      }),
      tx({
        type: "transfer", amount: 200, account_id: COMPANY_ACC,
        team_id: null, payment_method: null, transfer_group_id: "g1",
      }),
    ];
    const b = breakdownAccountInflowByTeam(COMPANY_ACC, txs, ACCOUNTS);
    assert.deepEqual(b.collections, [{ teamId: "team-a", amount: 200 }]);
    assert.equal(b.transfersNet, 0);
    assert.equal(b.total, 200);
  });

  test("company→company collection lands on the NULL-team row", () => {
    const txs = [
      tx({
        type: "transfer", amount: -75, account_id: "acc-company-2",
        team_id: null, payment_method: null, transfer_group_id: "g2",
      }),
      tx({
        type: "transfer", amount: 75, account_id: COMPANY_ACC,
        team_id: null, payment_method: null, transfer_group_id: "g2",
      }),
    ];
    const accounts = [...ACCOUNTS, { id: "acc-company-2", brigade_id: null }];
    const b = breakdownAccountInflowByTeam(COMPANY_ACC, txs, accounts);
    assert.deepEqual(b.collections, [{ teamId: null, amount: 75 }]);
  });

  test("keeps the invariant: direct + collections + transfersNet + expensesNet = total", () => {
    const txs = [
      tx({ type: "income", amount: 100, team_id: "team-a", payment_method: "cash" }),
      tx({ type: "refund", amount: -20, team_id: "team-a", payment_method: "cash" }),
      tx({ type: "expense", amount: 35, team_id: null, payment_method: "card" }),
      tx({
        type: "transfer", amount: 50, account_id: COMPANY_ACC,
        team_id: null, payment_method: null, transfer_group_id: "g3",
      }),
      tx({
        type: "transfer", amount: -50, account_id: TEAM_B_ACC,
        team_id: "team-b", payment_method: null, transfer_group_id: "g3",
      }),
      // Отток: компания переводит на счёт team-a.
      tx({
        type: "transfer", amount: -10, account_id: COMPANY_ACC,
        team_id: null, payment_method: null, transfer_group_id: "g4",
      }),
      tx({
        type: "transfer", amount: 10, account_id: TEAM_A_ACC,
        team_id: "team-a", payment_method: null, transfer_group_id: "g4",
      }),
      // Шум: чужая операция не должна попасть в разбивку.
      tx({ type: "income", amount: 999, account_id: TEAM_B_ACC, team_id: "team-b" }),
    ];
    const b = breakdownAccountInflowByTeam(COMPANY_ACC, txs, ACCOUNTS);
    const directTotal = b.direct.reduce((s, r) => s + r.total, 0);
    const collectionsTotal = b.collections.reduce((s, r) => s + r.amount, 0);
    assert.equal(directTotal, 80);
    assert.equal(collectionsTotal, 50);
    assert.equal(b.transfersNet, -10);
    assert.equal(b.expensesNet, -35);
    assert.equal(b.total, 85);
    assert.equal(directTotal + collectionsTotal + b.transfersNet + b.expensesNet, b.total);
  });
});
