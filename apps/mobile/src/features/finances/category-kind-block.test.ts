import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { kindBlockRows } from "./category-kind-block";

const cat = (over: Partial<FinanceCategory>): FinanceCategory =>
  ({
    id: over.name ?? "c",
    name: "c",
    type: "expense",
    hidden: false,
    is_system: false,
    position: 0,
    team_id: "t",
    ...over,
  }) as FinanceCategory;

describe("блок вида категорий в шестерёнке (владелец 03.10, вариант 2)", () => {
  test("три первые по руке владельца, остальное — «Ещё N»", () => {
    const rows = kindBlockRows([
      cat({ name: "Топливо", position: 2 }),
      cat({ name: "Еда", position: 0 }),
      cat({ name: "Аренда", position: 3 }),
      cat({ name: "Инструмент", position: 1 }),
      cat({ name: "Связь", position: 4 }),
    ]);
    assert.deepEqual(rows.shown.map((c) => c.name), ["Еда", "Инструмент", "Топливо"]);
    assert.equal(rows.more, 2);
  });

  test("скрытая не показывается, но «Ещё» её считает — она на странице", () => {
    const rows = kindBlockRows([cat({ name: "Еда" }), cat({ name: "Старое", hidden: true })]);
    assert.deepEqual(rows.shown.map((c) => c.name), ["Еда"]);
    assert.equal(rows.more, 1);
    assert.equal(rows.total, 2);
  });

  test("служебные сервера не видны и не считаются", () => {
    const rows = kindBlockRows([cat({ name: "Услуги", is_system: true })]);
    assert.equal(rows.shown.length, 0);
    assert.equal(rows.total, 0);
  });
});
