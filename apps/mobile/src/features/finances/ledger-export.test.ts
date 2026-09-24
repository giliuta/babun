import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { csvAmount, ledgerToCsv } from "./ledger-export";

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "t",
    type: "income",
    amount: 100,
    account_id: "acc",
    category_id: null,
    client_id: null,
    team_id: "team",
    payment_method: "cash",
    notes: null,
    vat_mode: null,
    vat_rate: null,
    vat_amount: null,
    occurred_on: "2026-09-10",
    occurred_time: "10:30",
    created_at: "2026-09-10T10:30:00Z",
    ...over,
  }) as FinanceTransaction;

const REFS = {
  accounts: [{ id: "acc", name: "Наличные" }],
  categories: [{ id: "cat", name: "Топливо" }],
  clients: [{ id: "c1", full_name: "Андрей" }],
  teams: [{ id: "team", name: "Y&D" }],
};

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("выгрузка операций для бухгалтера", () => {
  test("сумма — число с запятой и знаком", () => {
    assert.equal(csvAmount(55), "55,00");
    assert.equal(csvAmount(-55.5), "-55,50");
    assert.equal(csvAmount(0.1 + 0.2), "0,30");
    assert.equal(csvAmount(null), "");
  });

  test("строка несёт дату, вид, знак, счёт, категорию, клиента и команду", () => {
    const out = lines(
      ledgerToCsv(
        [
          tx({ id: "e", type: "expense", amount: 20, category_id: "cat", occurred_on: "2026-09-11", notes: "бензин" }),
          tx({ id: "i", type: "income", amount: 160, client_id: "c1", vat_amount: 25.55, vat_rate: 19, vat_mode: "inclusive" }),
        ],
        REFS,
      ),
    );
    assert.equal(out.length, 3);
    assert.match(out[0], /^Дата;Время;Вид;Сумма;VAT;Ставка VAT;Счёт/);
    // Старая дата первой.
    assert.equal(out[1], "10.09.2026;10:30;Доход;160,00;25,55;19%;Наличные;;Андрей;Y&D;Наличные;");
    assert.equal(out[2], "11.09.2026;10:30;Расход;-20,00;;;Наличные;Топливо;;Y&D;Наличные;бензин");
  });

  test("«Без VAT» руками — налоговая колонка пустая; формула в заметке обезврежена", () => {
    const out = lines(
      ledgerToCsv([tx({ vat_mode: "none", vat_amount: 10, vat_rate: 19, notes: "=SUM(A1)" })], REFS),
    );
    assert.equal(out[1], "10.09.2026;10:30;Доход;100,00;;;Наличные;;;Y&D;Наличные;'=SUM(A1)");
  });

  test("выплата зарплаты называет получателя в колонке категории", () => {
    const out = lines(
      ledgerToCsv(
        [tx({ id: "s", type: "expense", amount: 500, category_id: "sal", master_id: "m1" } as Partial<FinanceTransaction>)],
        {
          ...REFS,
          categories: [{ id: "sal", name: "Зарплата" }],
          people: [{ id: "m1", full_name: "Даня" }],
        },
      ),
    );
    assert.ok(out[1]?.includes("Зарплата · Даня"), out[1]);
  });
});
