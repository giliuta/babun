import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { buildStatementDocument } from "./statement-document";
import { buildStatementPdfHtml } from "./statement-pdf";

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "t",
    type: "income",
    amount: 100,
    account_id: "kasa",
    category_id: null,
    client_id: null,
    team_id: "team",
    master_id: null,
    payment_method: "cash",
    notes: null,
    vat_mode: null,
    vat_rate: null,
    vat_amount: null,
    transfer_group_id: null,
    reversal_kind: null,
    occurred_on: "2026-09-10",
    occurred_time: "10:30",
    created_at: "2026-09-10T10:30:00Z",
    ...over,
  }) as FinanceTransaction;

const REFS = {
  accounts: [
    { id: "kasa", name: "Kasa" },
    { id: "rev", name: "Revolut" },
  ],
  categories: [{ id: "fuel", name: "Топливо" }],
  clients: [{ id: "c1", full_name: "Андрей" }],
};

const build = (transactions: FinanceTransaction[], opening = 5) =>
  buildStatementDocument({
    account: { id: "kasa", name: "Kasa", opening_balance: opening },
    teamName: "Команда 1",
    transactions,
    refs: REFS,
    today: "2026-10-03",
  });

describe("выписка счёта (владелец 03.10: сначала лист, потом файл)", () => {
  test("остаток идёт от начала вниз и кончается тем же, что у сервера", () => {
    const doc = build([
      // Порядок из базы — новые сверху; выписка переставляет от старых.
      tx({ id: "b", type: "expense", amount: 35, category_id: "fuel", occurred_on: "2026-09-12" }),
      tx({ id: "a", amount: 120, client_id: "c1", occurred_on: "2026-09-10" }),
      tx({ id: "c", type: "refund", amount: -20, client_id: "c1", occurred_on: "2026-09-12", occurred_time: "18:00", reversal_kind: "client_refund" }),
    ]);
    assert.deepEqual(
      doc.days.map((d) => [d.date, d.rows.map((r) => [r.title, r.amount, r.balance])]),
      [
        ["10.09.2026", [["Андрей", "+€120", "€125"]]],
        ["12.09.2026", [["Топливо", "−€35", "€90"], ["Андрей", "−€20", "€70"]]],
      ],
    );
    assert.equal(doc.opening, "€5");
    assert.equal(doc.income, "+€120");
    assert.equal(doc.expense, "−€55");
    // 5 + 120 − 35 − 20: тот же счёт, что у `account_balances`.
    assert.equal(doc.closing, "€70");
    assert.equal(doc.period, "10.09.2026 — 03.10.2026");
  });

  test("чужие счета в выписку не попадают, но перевод называет другой счёт", () => {
    const doc = build([
      tx({ id: "out", type: "transfer", amount: -50, transfer_group_id: "g1", payment_method: null }),
      tx({ id: "in", type: "transfer", amount: 50, account_id: "rev", transfer_group_id: "g1", payment_method: null }),
      tx({ id: "other", account_id: "rev", amount: 999 }),
    ]);
    const rows = doc.days.flatMap((d) => d.rows);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, "На Revolut");
    assert.equal(rows[0]?.detail, "Перевод");
    assert.equal(doc.closing, "−€45");
  });

  test("подпись строки: вид и способ, без повтора вида в заголовке", () => {
    const doc = build([
      tx({ id: "x", amount: 10 }),
      tx({ id: "y", type: "refund", amount: -10, reversal_kind: "not_received", client_id: "c1" }),
    ]);
    const rows = doc.days.flatMap((d) => d.rows);
    assert.equal(rows[0]?.title, "Доход");
    assert.equal(rows[0]?.detail, "Наличные");
    assert.equal(rows[1]?.detail, "Оплата снята · Наличные");
  });

  test("без операций лист честно пустой: начало равно концу", () => {
    const doc = build([], 5);
    assert.equal(doc.days.length, 0);
    assert.equal(doc.closing, "€5");
    assert.equal(doc.period, "03.10.2026 — 03.10.2026");
    assert.ok(buildStatementPdfHtml(doc).includes("Операций не было"));
  });

  test("копейки не плывут: сорок строк по 0,10", () => {
    const many = Array.from({ length: 40 }, (_, i) => tx({ id: `m${i}`, amount: 0.1, created_at: `2026-09-10T10:${String(i).padStart(2, "0")}:00Z` }));
    assert.equal(build(many, 0).closing, "€4");
  });

  test("в PDF имена экранируются — заметка не становится разметкой", () => {
    const html = buildStatementPdfHtml(build([tx({ id: "h", notes: "<b>x</b>" })]));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(!html.includes("<b>x</b>"));
  });
});
