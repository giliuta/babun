import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { MemberAccessMap } from "@/features/access/access-map";
import type { FinanceDocument } from "./documents";
import {
  financeReadRules,
  moneyPanelOpen,
  moneySides,
  readableDebts,
  readableDocuments,
  readableTransactions,
} from "./finance-read-rules";

// ЗЕРКАЛО ЧИТАЕТ ТОКЕНОМ ВЛАДЕЛЬЦА: сервер отдаёт все строки, и правило здесь —
// единственное, что не даёт «его глазами» показать расход при «Расходы: Не
// видит». Ловится и обратное: владелец не должен потерять ни одной строки.

const A = "team-a";
const B = "team-b";
type Lvl = "off" | "read" | "write" | "full";

const map = (calendars: Record<string, Record<string, Lvl>>, isOwner = false): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner,
  version: 1,
  company: {},
  calendars,
  attachedCalendars: Object.keys(calendars),
});

const tx = (
  id: string,
  type: FinanceTransaction["type"],
  teamId: string | null,
  debtId: string | null = null,
): FinanceTransaction =>
  ({ id, type, team_id: teamId, debt_id: debtId, amount: 10 }) as unknown as FinanceTransaction;

const ROWS = [
  tx("in-a", "income", A),
  tx("rf-a", "refund", A),
  tx("ex-a", "expense", A),
  tx("tr-a", "transfer", A),
  tx("in-b", "income", B),
  tx("in-none", "income", null),
];
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const NO_DEBTS = new Map<string, string | null>();

const partner = (levels: Record<string, Lvl>, role: "master" | "dispatcher" = "master") =>
  financeReadRules({ role, map: map({ [A]: levels }) });

describe("владелец — без изменений", () => {
  test("журнал, долги и документы возвращаются тем же массивом", () => {
    for (const rules of [
      financeReadRules({ role: "owner", map: undefined }),
      financeReadRules({ role: undefined, map: map({}, true) }),
    ]) {
      assert.equal(readableTransactions(ROWS, rules, NO_DEBTS), ROWS);
      const debts = [{ id: "d", team_id: null }];
      assert.equal(readableDebts(debts, rules), debts);
      const docs = [{ id: "i", kind: "invoice" }] as FinanceDocument[];
      assert.equal(readableDocuments(docs, [], rules), docs);
      assert.equal(rules.documentReadable(null), true);
    }
    assert.deepEqual(moneySides({ role: "owner", map: undefined }), { income: true, expense: true });
    for (const panel of ["income", "expense", "profit", "check", "services"]) {
      assert.equal(moneyPanelOpen(panel, { income: true, expense: true }), true, panel);
    }
  });
});

describe("сотрудник и зеркало — строка по своей стороне и своей команде", () => {
  test("«Расходы: Не видит» — расхода в ленте нет, доход и возврат на месте", () => {
    const rules = partner({ "finance.income": "read", "finance.expense": "off" });
    assert.deepEqual(ids(readableTransactions(ROWS, rules, NO_DEBTS)), ["in-a", "rf-a"]);
  });

  test("«Доходы: Не видит» — остаётся только расход", () => {
    const rules = partner({ "finance.income": "off", "finance.expense": "write" });
    assert.deepEqual(ids(readableTransactions(ROWS, rules, NO_DEBTS)), ["ex-a"]);
  });

  test("переводы — только со «Счетами»", () => {
    const off = partner({ "finance.income": "read", "finance.expense": "read" });
    assert.ok(!ids(readableTransactions(ROWS, off, NO_DEBTS)).includes("tr-a"));
    const on = partner({ "finance.accounts": "read" });
    assert.deepEqual(ids(readableTransactions(ROWS, on, NO_DEBTS)), ["tr-a"]);
  });

  test("чужая команда и строка без команды не видны никогда", () => {
    const rules = partner({ "finance.income": "full", "finance.expense": "full", "finance.accounts": "full" });
    assert.deepEqual(ids(readableTransactions(ROWS, rules, NO_DEBTS)), ["in-a", "rf-a", "ex-a", "tr-a"]);
  });

  test("старая общая строка `finance.operations` (сервер её не знает) ничего не открывает", () => {
    const rules = partner({ "finance.operations": "read" });
    assert.deepEqual(ids(readableTransactions(ROWS, rules, NO_DEBTS)), []);
  });

  test("оплата долга видна и по «Долгам» команды долга", () => {
    const pay = tx("pay", "expense", A, "debt-1");
    const debtsOnly = partner({ "finance.debts": "read" });
    assert.deepEqual(ids(readableTransactions([pay], debtsOnly, new Map([["debt-1", A]]))), ["pay"]);
    // Долг другой команды — «Долги» в A его не открывают.
    assert.deepEqual(ids(readableTransactions([pay], debtsOnly, new Map([["debt-1", B]]))), []);
    // Долг экрану неизвестен — команда платежа.
    assert.deepEqual(ids(readableTransactions([pay], debtsOnly, NO_DEBTS)), ["pay"]);
    assert.deepEqual(ids(readableTransactions([pay], partner({}), NO_DEBTS)), []);
  });

  test("«Долги: Не видит» — ручных долгов нет; «Видит» — только своей команды", () => {
    const debts = [
      { id: "da", team_id: A },
      { id: "db", team_id: B },
      { id: "dn", team_id: null },
    ];
    assert.deepEqual(ids(readableDebts(debts, partner({ "finance.income": "write" }))), []);
    assert.deepEqual(ids(readableDebts(debts, partner({ "finance.debts": "read" }))), ["da"]);
  });

  test("роль или карта ещё не пришли — не видно ничего", () => {
    const rules = financeReadRules({ role: undefined, map: undefined });
    assert.deepEqual(readableTransactions(ROWS, rules, NO_DEBTS), []);
    assert.deepEqual(moneySides({ role: "master", map: undefined }), { income: false, expense: false });
  });
});

describe("документы", () => {
  const receipt = (id: string, transactionId: string | null, teamId: string | null): Receipt =>
    ({ id, transaction_id: transactionId, team_id: teamId }) as unknown as Receipt;
  const RECEIPTS = [
    receipt("r-a", "in-a", A),
    receipt("r-b", "in-b", B),
    receipt("r-free", null, A),
    receipt("r-old", "tx-outside-window", A),
  ];
  const DOCS = [
    { id: "inv-1", kind: "invoice", teamId: A },
    { id: "inv-2", kind: "invoice", teamId: B },
    ...RECEIPTS.map((r) => ({ id: r.id, kind: "receipt", teamId: r.team_id })),
    { id: "r-unknown", kind: "receipt", teamId: A },
  ] as FinanceDocument[];

  test("«Документы: Скрыты» — ни одного, даже чека своей операции (владелец 04.10)", () => {
    const rules = partner({ "finance.income": "write" });
    assert.deepEqual(ids(readableDocuments(DOCS, RECEIPTS, rules)), []);
  });

  test("мастер без «Доходов» не видит ни одного чека", () => {
    const rules = partner({ "finance.expense": "write", "finance.accounts": "write" });
    assert.deepEqual(ids(readableDocuments(DOCS, RECEIPTS, rules)), []);
  });

  test("«Документы: Видит» в команде — её инвойсы и чеки, чужой — нет (03.10)", () => {
    const rules = partner({ "finance.documents": "read" });
    assert.deepEqual(ids(readableDocuments(DOCS, RECEIPTS, rules)), [
      "inv-1",
      "r-a",
      "r-free",
      "r-old",
    ]);
  });

  test("диспетчер: инвойсов нет, чеки — все (`receipts_read`)", () => {
    const rules = partner({}, "dispatcher");
    assert.deepEqual(ids(readableDocuments(DOCS, RECEIPTS, rules)), [
      "r-a",
      "r-b",
      "r-free",
      "r-old",
    ]);
  });
});

describe("аналитика — стороны денег порознь", () => {
  test("доход без расхода: панели расхода и прибыли закрыты", () => {
    const sides = moneySides({ role: "master", map: map({ [A]: { "finance.income": "read" } }) });
    assert.deepEqual(sides, { income: true, expense: false });
    assert.equal(moneyPanelOpen("income", sides), true);
    assert.equal(moneyPanelOpen("check", sides), true);
    assert.equal(moneyPanelOpen("expense", sides), false);
    assert.equal(moneyPanelOpen("profit", sides), false);
  });

  test("расход без дохода: закрыты доход, средний чек и прибыль", () => {
    const sides = moneySides({ role: "master", map: map({ [B]: { "finance.expense": "write" } }) });
    assert.deepEqual(sides, { income: false, expense: true });
    for (const panel of ["income", "check", "profit"]) {
      assert.equal(moneyPanelOpen(panel, sides), false, panel);
    }
    assert.equal(moneyPanelOpen("services", sides), true);
  });

  test("уровень — лучший по календарям; старая общая строка сторон не открывает", () => {
    const sides = moneySides({
      role: "dispatcher",
      map: map({ [A]: { "finance.income": "off" }, [B]: { "finance.income": "full" } }),
    });
    assert.deepEqual(sides, { income: true, expense: false });
    assert.deepEqual(
      moneySides({ role: "master", map: map({ [A]: { "finance.operations": "read" } }) }),
      { income: false, expense: false },
    );
  });
});

describe("«Ограничения» финансов (03.10) — окно, как у сервера", () => {
  const dated = (id: string, type: FinanceTransaction["type"], day: string, debtId: string | null = null) =>
    ({ ...tx(id, type, A, debtId), occurred_on: day }) as FinanceTransaction;
  const rows = [
    dated("old-in", "income", "2026-09-20"),
    dated("new-in", "income", "2026-09-30"),
    dated("old-ex", "expense", "2026-08-01"),
    dated("old-debt-pay", "income", "2026-08-01", "debt-1"),
  ];
  const rules = (window: string | undefined, today: string | null = "2026-10-03") =>
    financeReadRules({
      role: "master",
      map: map({
        [A]: {
          "finance.income": "read",
          "finance.expense": "read",
          ...(window ? { "finance.window": window as Lvl } : {}),
        },
      }),
      today: today ?? undefined,
    });

  test("«Неделя» — старые доход и расход уходят, платёж по долгу остаётся", () => {
    assert.deepEqual(ids(readableTransactions(rows, rules("week"), new Map([["debt-1", A]]))), ["new-in", "old-debt-pay"]);
  });

  test("«Без ограничения», нет ступени в карте или нет «сегодня» — всё как было", () => {
    // Все четыре — доходы и расходы команды A, платёж по долгу тоже доход.
    assert.equal(readableTransactions(rows, rules("own"), NO_DEBTS).length, 4);
    assert.equal(readableTransactions(rows, rules(undefined), NO_DEBTS).length, 4);
    assert.equal(readableTransactions(rows, rules("week", null), NO_DEBTS).length, 4);
  });

  test("владелец — окно не режет", () => {
    const owner = financeReadRules({ role: "owner", map: undefined, today: "2026-10-03" });
    assert.equal(readableTransactions(rows, owner, NO_DEBTS).length, 4);
  });
});
