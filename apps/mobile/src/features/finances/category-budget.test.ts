import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  budgetAlerts,
  budgetLeftLine,
  budgetLevel,
  monthOf,
  monthSpendByCategory,
  parseBudgetInput,
  type BudgetCategory,
} from "./category-budget";

const fmt = (n: number) => `€${Math.round(n * 100) / 100}`;

const fuel: BudgetCategory = { id: "fuel", name: "Топливо", type: "expense", monthly_budget: 250 };
const rent: BudgetCategory = { id: "rent", name: "Аренда", type: "expense", monthly_budget: null };
const tips: BudgetCategory = { id: "tips", name: "Чаевые", type: "income", monthly_budget: 100 };

describe("бюджет категории", () => {
  test("месяц: границы и високосный февраль", () => {
    assert.deepEqual(monthOf("2026-09-24"), { from: "2026-09-01", to: "2026-09-30", key: "2026-09" });
    assert.deepEqual(monthOf("2028-02-10"), { from: "2028-02-01", to: "2028-02-29", key: "2028-02" });
  });

  test("потрачено — только расходы с категорией", () => {
    const spend = monthSpendByCategory([
      { type: "expense", amount: 100, category_id: "fuel" },
      { type: "expense", amount: 80.5, category_id: "fuel" },
      { type: "income", amount: 500, category_id: "fuel" },
      { type: "transfer", amount: 50, category_id: null },
      { type: "expense", amount: 20, category_id: null },
    ]);
    assert.equal(spend.get("fuel"), 180.5);
    assert.equal(spend.size, 1);
  });

  test("пороги: 80% и 100% в центах", () => {
    assert.equal(budgetLevel(199.99, 250), 0);
    assert.equal(budgetLevel(200, 250), 80);
    assert.equal(budgetLevel(249.99, 250), 80);
    assert.equal(budgetLevel(250, 250), 100);
    assert.equal(budgetLevel(300, 250), 100);
  });

  test("уведомление — один раз на порог за месяц", () => {
    const first = budgetAlerts([fuel, rent, tips], new Map([["fuel", 210]]), {}, "2026-09", fmt);
    assert.equal(first.notices.length, 1);
    assert.equal(first.notices[0].level, 80);
    assert.match(first.notices[0].body, /осталось €40/);
    assert.deepEqual(first.next, { "fuel:2026-09": 80 });

    const again = budgetAlerts([fuel], new Map([["fuel", 230]]), first.next, "2026-09", fmt);
    assert.equal(again.notices.length, 0, "тот же порог второй раз не сообщается");

    const over = budgetAlerts([fuel], new Map([["fuel", 280]]), again.next, "2026-09", fmt);
    assert.equal(over.notices.length, 1);
    assert.match(over.notices[0].title, /превышен/);
    assert.match(over.notices[0].body, /сверх бюджета €30/);
  });

  test("сразу за 100% — одно уведомление, а не два", () => {
    const r = budgetAlerts([fuel], new Map([["fuel", 400]]), {}, "2026-09", fmt);
    assert.equal(r.notices.length, 1);
    assert.equal(r.notices[0].level, 100);
  });

  test("новый месяц и снятый бюджет — память чистится", () => {
    const r = budgetAlerts([fuel], new Map([["fuel", 10]]), { "fuel:2026-08": 100, "rent:2026-09": 80 }, "2026-09", fmt);
    assert.deepEqual(r.next, {});
    assert.equal(r.notices.length, 0);
  });

  test("доход и категория без бюджета не сообщают", () => {
    const r = budgetAlerts([rent, tips], new Map([["rent", 9999], ["tips", 9999]]), {}, "2026-09", fmt);
    assert.equal(r.notices.length, 0);
  });

  test("строка в форме операции", () => {
    assert.equal(budgetLeftLine(180, 250, fmt), "Бюджет: осталось €70 из €250");
    assert.equal(budgetLeftLine(250, 250, fmt), "Бюджет €250 исчерпан");
    assert.equal(budgetLeftLine(280, 250, fmt), "Сверх бюджета €30 · бюджет €250");
  });

  test("поле бюджета: пусто и ноль — без бюджета, мусор — ошибка", () => {
    assert.equal(parseBudgetInput(""), null);
    assert.equal(parseBudgetInput(" 250 "), 250);
    assert.equal(parseBudgetInput("99,5"), 99.5);
    assert.equal(parseBudgetInput("0"), null);
    assert.equal(parseBudgetInput("abc"), undefined);
    assert.equal(parseBudgetInput("1.234"), undefined);
  });
});
