import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MemberAccessMap } from "@/session/access-map";
import { statementIsComplete } from "./statement-complete";
import { INCOMPLETE_STATEMENT_NOTICE, buildStatementDocument } from "./statement-document";
import { buildStatementPdfHtml } from "./statement-pdf";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";

const A = "team-a";
type Lvl = "off" | "read" | "write" | "full" | "own" | "week";

const map = (levels: Record<string, Lvl>): MemberAccessMap => ({
  tenantId: "t",
  isOwner: false,
  version: 1,
  company: {},
  calendars: { [A]: levels },
  attachedCalendars: [A],
});

const FULL: Record<string, Lvl> = {
  "finance.income": "read",
  "finance.expense": "read",
  "finance.accounts": "read",
};
const today = "2026-10-16";
const complete = (levels: Record<string, Lvl>, teamId: string | null = A) =>
  statementIsComplete({ role: "master", map: map(levels), teamId, today });

describe("видны ли партнёру все операции счёта", () => {
  test("владелец — всегда", () => {
    assert.equal(statementIsComplete({ role: "owner", map: undefined, teamId: null, today }), true);
  });

  test("доходы, расходы и переводы команды открыты, окна нет — полная", () => {
    assert.equal(complete(FULL), true);
    assert.equal(complete({ ...FULL, "finance.window": "own" }), true);
  });

  test("не видит одну из сторон денег или переводы — неполная", () => {
    assert.equal(complete({ ...FULL, "finance.expense": "off" }), false);
    assert.equal(complete({ ...FULL, "finance.income": "off" }), false);
    assert.equal(complete({ ...FULL, "finance.accounts": "off" }), false);
  });

  test("«Ограничения» по сроку — неполная", () => {
    assert.equal(complete({ ...FULL, "finance.window": "week" }), false);
  });

  test("права не пришли или у счёта нет команды — полноту не доказать", () => {
    assert.equal(statementIsComplete({ role: undefined, map: undefined, teamId: A, today }), false);
    assert.equal(complete(FULL, null), false);
  });
});

describe("неполная выписка не выдаёт себя за сверку", () => {
  const tx = {
    id: "t1", type: "income", amount: 100, account_id: "kasa", category_id: null, client_id: null,
    team_id: A, master_id: null, payment_method: "cash", notes: null, vat_mode: null, vat_rate: null,
    vat_amount: null, transfer_group_id: null, reversal_kind: null, occurred_on: "2026-10-10",
    occurred_time: "10:00", created_at: "2026-10-10T10:00:00Z",
  } as unknown as FinanceTransaction;
  const build = (isComplete: boolean) =>
    buildStatementDocument({
      account: { id: "kasa", name: "Kasa", opening_balance: 5 },
      teamName: null,
      transactions: [tx],
      refs: { accounts: [], categories: [], clients: [] },
      today,
      complete: isComplete,
    });

  test("остатки заменены прочерком, сказано, что выписка неполная", () => {
    const doc = build(false);
    assert.equal(doc.notice, INCOMPLETE_STATEMENT_NOTICE);
    assert.equal(doc.opening, "—");
    assert.equal(doc.closing, "—");
    assert.equal(doc.days[0]?.rows[0]?.balance, "—");
  });

  test("полная — как была: остатки на месте, пометки нет", () => {
    const doc = build(true);
    assert.equal(doc.notice, null);
    assert.notEqual(doc.closing, "—");
  });

  test("файл несёт ту же пометку", () => {
    assert.ok(buildStatementPdfHtml(build(false)).includes("Выписка неполная"));
    assert.ok(!buildStatementPdfHtml(build(true)).includes("Выписка неполная"));
  });
});
