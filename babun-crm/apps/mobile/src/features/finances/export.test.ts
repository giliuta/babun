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
    vat_mode: null,
    vat_rate: null,
    vat_amount: null,
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
        hidden: false,
      },
    ];
    const result = financeTransactionsToCsv(
      [
        transaction({
          category_id: "category-1",
          notes: "Первая\nстрока",
          team_id: "team-1",
          account_id: "account-1",
          payment_method: "cash",
        }),
        transaction({ id: "transfer", type: "transfer", amount: -50 }),
        transaction({ id: "refund", type: "refund", amount: -20 }),
      ],
      categories,
      {
        teamName: new Map([["team-1", "Юра"]]),
        accounts: [{ id: "account-1", name: "Наличка" }],
      },
    );

    assert.equal(result.count, 2);
    assert.ok(
      result.contents.startsWith(
        "\uFEFFДата;Тип;Категория;Команда;Счёт;Способ оплаты;Сумма;НДС;Без НДС;Ставка;Режим НДС;Документ;Заметка\r\n",
      ),
    );
    assert.match(result.contents, /"Сервис; монтаж"/);
    assert.match(result.contents, /"Первая\nстрока"/);
    assert.match(result.contents, /Юра;Наличка;Наличные;125.5;0;125.5;;;;/);
    // NULL team_id — общекорпоративная операция: колонка «Команда» = Компания.
    assert.match(result.contents, /Возврат;;Компания;;;-20;0;-20;/);
    assert.doesNotMatch(result.contents, /^.*Перевод;;/m);
  });

  // Бухгалтеру нужен РАЗБОР суммы, а не валовая цифра: сколько налога и что
  // осталось компании. Отдельная колонка «Документ» отвечает на вопрос, какие
  // расходы вообще можно принять к зачёту.
  test("печатает налог, ставку, режим и наличие документа", () => {
    const result = financeTransactionsToCsv(
      [
        transaction({
          amount: 476,
          vat_mode: "exclusive",
          vat_rate: 19,
          vat_amount: 76,
          receipt_url: "tenant/receipt.jpg",
        }),
      ],
      [],
    );
    assert.match(result.contents, /476;76;400;19;Плюс НДС;есть;/);
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
        hidden: false,
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
