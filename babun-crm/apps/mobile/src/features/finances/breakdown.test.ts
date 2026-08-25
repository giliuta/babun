// Тесты «Разбора прибыли»: неттинг возвратов — денежное правило, которым
// секции сходятся с «Прибылью» на герое экрана. Ошибка здесь не падает —
// она печатает владельцу другую сумму, поэтому каждое правило закреплено.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { signedAmount } from "@babun/shared/local/finance/transaction";
import type {
  FinanceTransaction,
  TransactionType,
} from "@babun/shared/local/finance/transaction";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import {
  breakdownExpense,
  breakdownIncome,
  expenseLabel,
  incomeLabel,
} from "./breakdown";

function tx(
  patch: Partial<FinanceTransaction> & {
    id: string;
    type: TransactionType;
    amount: number;
  },
): FinanceTransaction {
  return {
    tenant_id: "t",
    currency: "EUR",
    category_id: null,
    account_id: "acc-1",
    appointment_id: null,
    appointment_payment_kind: null,
    client_id: null,
    team_id: null,
    master_id: null,
    payment_method: null,
    notes: null,
    vat_mode: null,
    vat_rate: null,
    vat_amount: null,
    occurred_on: "2026-08-10",
    receipt_url: null,
    transfer_group_id: null,
    invoice_id: null,
    refund_of_id: null,
    source: "manual",
    created_at: "2026-08-10T09:00:00Z",
    updated_at: "2026-08-10T09:00:00Z",
    created_by: null,
    ...patch,
  };
}

const CATEGORIES: FinanceCategory[] = [
  {
    id: "cat-fuel",
    tenant_id: "t",
    slug: "fuel",
    name: "Бензин",
    type: "expense",
    icon: null,
    color: null,
    hidden: false,
  },
  {
    id: "cat-service",
    tenant_id: "t",
    slug: "service",
    name: "Обслуживание",
    type: "income",
    icon: null,
    color: null,
    hidden: false,
  },
];

// Разбору от услуги и записи нужны только имя и связка service_ids —
// полные Row-типы здесь были бы шумом на сотню полей.
const SERVICES = [
  { id: "s-clean", name: "Чистка сплита" } as Service,
  { id: "s-install", name: "Монтаж" } as Service,
];
const APPOINTMENTS = [
  { id: "a-1", service_ids: ["s-clean"] } as Appointment,
  { id: "a-2", service_ids: ["s-install"] } as Appointment,
];

describe("incomeLabel — категория > первая услуга записи > «Доход»", () => {
  test("категория побеждает запись", () => {
    const t = tx({
      id: "i1",
      type: "income",
      amount: 100,
      category_id: "cat-service",
      appointment_id: "a-1",
    });
    assert.equal(incomeLabel(t, CATEGORIES, SERVICES, APPOINTMENTS), "Обслуживание");
  });

  test("без категории — первая услуга привязанной записи", () => {
    const t = tx({ id: "i2", type: "income", amount: 100, appointment_id: "a-1" });
    assert.equal(incomeLabel(t, CATEGORIES, SERVICES, APPOINTMENTS), "Чистка сплита");
  });

  test("без категории и записи — родовое «Доход»", () => {
    const t = tx({ id: "i3", type: "income", amount: 100 });
    assert.equal(incomeLabel(t, CATEGORIES, SERVICES, APPOINTMENTS), "Доход");
  });
});

describe("expenseLabel — категория > заметка > «Прочее»", () => {
  test("категория побеждает заметку", () => {
    const t = tx({
      id: "e1",
      type: "expense",
      amount: 40,
      category_id: "cat-fuel",
      notes: "заправка",
    });
    assert.equal(expenseLabel(t, CATEGORIES), "Бензин");
  });

  test("без категории — заметка, без заметки — «Прочее»", () => {
    assert.equal(
      expenseLabel(tx({ id: "e2", type: "expense", amount: 40, notes: "фреон" }), CATEGORIES),
      "фреон",
    );
    assert.equal(
      expenseLabel(tx({ id: "e3", type: "expense", amount: 40 }), CATEGORIES),
      "Прочее",
    );
  });
});

describe("breakdownIncome — возвраты неттятся в свою услугу", () => {
  test("возврат в периоде уменьшает корзину исходного дохода и не растит count", () => {
    const rows = breakdownIncome(
      [
        tx({ id: "i1", type: "income", amount: 120, appointment_id: "a-1" }),
        tx({ id: "i2", type: "income", amount: 80, appointment_id: "a-1" }),
        tx({ id: "r1", type: "refund", amount: 50, refund_of_id: "i1" }),
      ],
      CATEGORIES,
      SERVICES,
      APPOINTMENTS,
    );
    assert.deepEqual(rows, [
      { id: "Чистка сплита", name: "Чистка сплита", amount: 150, count: 2 },
    ]);
  });

  test("сиротский возврат (доход вне периода) падает в «Возвраты» с минусом", () => {
    const rows = breakdownIncome(
      [
        tx({ id: "i1", type: "income", amount: 200, appointment_id: "a-2" }),
        tx({ id: "r1", type: "refund", amount: 30, refund_of_id: "i-out-of-window" }),
        tx({ id: "r2", type: "refund", amount: 20 }),
      ],
      CATEGORIES,
      SERVICES,
      APPOINTMENTS,
    );
    assert.deepEqual(rows, [
      { id: "Монтаж", name: "Монтаж", amount: 200, count: 1 },
      { id: "Возвраты", name: "Возвраты", amount: -50, count: 0 },
    ]);
  });

  test("полностью возвращённая услуга исчезает из списка", () => {
    const rows = breakdownIncome(
      [
        tx({ id: "i1", type: "income", amount: 90, appointment_id: "a-1" }),
        tx({ id: "r1", type: "refund", amount: 90, refund_of_id: "i1" }),
        tx({ id: "i2", type: "income", amount: 10, appointment_id: "a-2" }),
      ],
      CATEGORIES,
      SERVICES,
      APPOINTMENTS,
    );
    assert.deepEqual(rows.map((r) => r.name), ["Монтаж"]);
  });

  test("возврат с отрицательной суммой из триггера неттится так же, как ручной", () => {
    // Авто-возврат сервер пишет отрицательным числом; signedAmount берёт
    // модуль со знаком минус в обоих случаях — корзина не должна зависеть
    // от того, кто родил проводку.
    const rows = breakdownIncome(
      [
        tx({ id: "i1", type: "income", amount: 100, appointment_id: "a-1" }),
        tx({ id: "r1", type: "refund", amount: -40, refund_of_id: "i1", source: "auto" }),
      ],
      CATEGORIES,
      SERVICES,
      APPOINTMENTS,
    );
    assert.deepEqual(rows, [
      { id: "Чистка сплита", name: "Чистка сплита", amount: 60, count: 1 },
    ]);
  });

  test("переводы и расходы в доходные корзины не попадают", () => {
    const rows = breakdownIncome(
      [
        tx({ id: "i1", type: "income", amount: 70 }),
        tx({ id: "e1", type: "expense", amount: 30, category_id: "cat-fuel" }),
        tx({ id: "t1", type: "transfer", amount: 500 }),
      ],
      CATEGORIES,
      SERVICES,
      APPOINTMENTS,
    );
    assert.deepEqual(rows, [{ id: "Доход", name: "Доход", amount: 70, count: 1 }]);
  });
});

describe("breakdownExpense — группировка по категории/заметке", () => {
  test("строки группируются и сортируются по сумме", () => {
    const rows = breakdownExpense(
      [
        tx({ id: "e1", type: "expense", amount: 25, category_id: "cat-fuel" }),
        tx({ id: "e2", type: "expense", amount: 35, category_id: "cat-fuel" }),
        tx({ id: "e3", type: "expense", amount: 40, notes: "фреон" }),
        tx({ id: "i1", type: "income", amount: 999 }),
      ],
      CATEGORIES,
    );
    assert.deepEqual(rows, [
      { id: "Бензин", name: "Бензин", amount: 60, count: 2 },
      { id: "фреон", name: "фреон", amount: 40, count: 1 },
    ]);
  });
});

describe("секции сходятся с «Прибылью»", () => {
  test("Σ строк дохода − Σ строк расхода = прибыль периода по signedAmount", () => {
    const journal = [
      tx({ id: "i1", type: "income", amount: 300, appointment_id: "a-1" }),
      tx({ id: "i2", type: "income", amount: 150, appointment_id: "a-2" }),
      tx({ id: "r1", type: "refund", amount: 50, refund_of_id: "i1" }),
      tx({ id: "r2", type: "refund", amount: 20 }), // сирота
      tx({ id: "e1", type: "expense", amount: 80, category_id: "cat-fuel" }),
      tx({ id: "e2", type: "expense", amount: 45, notes: "фреон" }),
    ];
    const incomeRows = breakdownIncome(journal, CATEGORIES, SERVICES, APPOINTMENTS);
    const expenseRows = breakdownExpense(journal, CATEGORIES);
    const incomeTotal = incomeRows.reduce((s, r) => s + r.amount, 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r.amount, 0);
    const profit = journal
      .filter((x) => x.type !== "transfer")
      .reduce((s, x) => s + signedAmount(x), 0);
    assert.equal(incomeTotal - expenseTotal, profit);
  });
});
