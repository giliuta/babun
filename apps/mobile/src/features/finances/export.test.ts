import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountStatementToCsv } from "./export";

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

describe("выписка по счёту", () => {
  const period = { from: "2026-06-01", to: "2026-06-30" };
  const totals = {
    opening_before: 0,
    income: 690,
    expense: -440,
    refund: -60,
    transfer_in: 150,
    transfer_out: 0,
    net: 190,
  };

  test("обрамляет ленту остатками и называет вторую сторону перевода", () => {
    const result = accountStatementToCsv({
      account: { id: "card", name: "Карта" },
      ledger: [
        transaction({ id: "in", account_id: "card", amount: 690 }),
        transaction({
          id: "leg-in",
          type: "transfer",
          account_id: "card",
          amount: 150,
          transfer_group_id: "g1",
          occurred_on: "2026-06-10",
        }),
        // Вторая нога лежит на ЧУЖОМ счёте — в выписку не попадает, но именно
        // из неё берётся имя корреспондента.
        transaction({
          id: "leg-out",
          type: "transfer",
          account_id: "cash",
          amount: -150,
          transfer_group_id: "g1",
          occurred_on: "2026-06-10",
        }),
      ],
      categories: [],
      totals,
      period,
      lookups: {
        accounts: [
          { id: "card", name: "Карта" },
          { id: "cash", name: "Наличные" },
        ],
      },
    });

    assert.equal(result.count, 2);
    const lines = result.contents.split("\r\n");
    assert.match(lines[0], /^﻿Дата;Тип;Категория;Команда;Корреспондент;/);
    assert.equal(
      lines[1],
      "2026-06-01;Остаток на начало;;;;;0,00;;;;;;;",
    );
    // Перевод в выписке по счёту остаётся и называет счёт, с которого пришёл:
    // здесь он часть движения денег этой кассы, а не доход компании.
    assert.match(result.contents, /Перевод;;Компания;Наличные;;150,00;/);
    // Остаток на конец складывается из тех же серверных колонок, что и
    // колонка «ЗА ПЕРИОД» на экране: 0 + 690 − 440 − 60 + 150.
    assert.equal(
      lines[lines.length - 1],
      "2026-06-30;Остаток на конец;;;;;340,00;;;;;;;",
    );
  });

  // Переехал сюда из выгрузки «Отчёт бухгалтеру», удалённой 2026-08-11: сама
  // защита живёт в csvTextCell и нужна любому файлу. Имя категории и заметку
  // пишет человек, а Excel исполняет ячейку, начинающуюся с «=» или «+», как
  // формулу — открытая выписка не должна ничего запускать.
  test("нейтрализует формулы в именах категорий и заметках", () => {
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
    const result = accountStatementToCsv({
      account: { id: "card", name: "Карта" },
      ledger: [
        transaction({
          type: "expense",
          account_id: "card",
          category_id: "category-1",
          notes: "+SUM(A1:A2)",
          occurred_on: "2026-06-10",
        }),
      ],
      categories,
      totals,
      period,
    });

    assert.match(result.contents, /'=CMD\(\)/);
    assert.match(result.contents, /'\+SUM\(A1:A2\)/);
  });

  // Легаси-строки до трёх клавиш НДС: налог записан, режим — нет. Колонка
  // обещает «как назначали», и выгрузка не имеет права печатать догадку.
  test("режим НДС без записи печатается прочерком, а не догадкой", () => {
    const result = accountStatementToCsv({
      account: { id: "card", name: "Карта" },
      ledger: [
        transaction({
          id: "legacy",
          account_id: "card",
          amount: 476,
          vat_mode: null,
          vat_rate: 19,
          vat_amount: 76,
          occurred_on: "2026-06-05",
        }),
        transaction({
          id: "keyed",
          account_id: "card",
          amount: 476,
          vat_mode: "inclusive",
          vat_rate: 19,
          vat_amount: 76,
          occurred_on: "2026-06-06",
        }),
      ],
      categories: [],
      totals,
      period,
    });

    const lines = result.contents.split("\r\n");
    const legacy = lines.find((l) => l.includes("legacy"));
    const keyed = lines.find((l) => l.includes("keyed"));
    // Ставка и сумма налога остаются — записаны честно; выдуман только режим.
    assert.match(legacy ?? "", /476,00;76,00;400,00;19;—;/);
    assert.doesNotMatch(legacy ?? "", /НДС включён/);
    assert.match(keyed ?? "", /;НДС включён;/);
  });
});
