import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { financeTransactionsToCsv } from "./export";

function transaction(
  patch: Partial<FinanceTransaction>,
): FinanceTransaction {
  return {
    id: "transaction-1",
    tenant_id: "tenant-1",
    type: "income",
    amount: 125.5,
    currency: "EUR",
    category_id: null,
    account_id: null,
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: null,
    master_id: null,
    payment_method: null,
    notes: null,
    occurred_on: "2026-07-20",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: null,
    refund_of_id: null,
    source: "manual",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    created_by: null,
    ...patch,
  };
}

describe("finance CSV export", () => {
  test("excludes internal transfers and preserves exact regional rows", () => {
    const categories: FinanceCategory[] = [
      {
        id: "category-1",
        tenant_id: "tenant-1",
        slug: "service",
        name: "Сервис; монтаж",
        type: "income",
        icon: null,
        color: null,
      },
    ];
    const result = financeTransactionsToCsv(
      [
        transaction({ category_id: "category-1", notes: "Первая\nстрока" }),
        transaction({ id: "transfer", type: "transfer", amount: -50 }),
        transaction({ id: "refund", type: "refund", amount: -20 }),
      ],
      categories,
    );

    assert.equal(result.count, 2);
    assert.ok(result.contents.startsWith("\uFEFFДата;Тип;Категория;Сумма;Заметка\r\n"));
    assert.match(result.contents, /"Сервис; монтаж"/);
    assert.match(result.contents, /"Первая\nстрока"/);
    assert.match(result.contents, /Возврат;;-20;/);
    assert.doesNotMatch(result.contents, /Перевод/);
  });

  test("neutralizes formulas in category names and notes", () => {
    const categories: FinanceCategory[] = [
      {
        id: "category-1",
        tenant_id: null,
        slug: "unsafe",
        name: "=CMD()",
        type: "expense",
        icon: null,
        color: null,
      },
    ];
    const result = financeTransactionsToCsv(
      [transaction({ type: "expense", category_id: "category-1", notes: "+SUM(A1:A2)" })],
      categories,
    );

    assert.match(result.contents, /'=CMD\(\)/);
    assert.match(result.contents, /'\+SUM\(A1:A2\)/);
  });
});
