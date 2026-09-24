import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asksOf, categoriesDoorLine, payeeName, payeeOptions, pickableCategories, withPayee } from "./category-asks";

const p = (id: string, full_name: string, team_id: string | null, is_active = true) => ({
  id,
  full_name,
  team_id,
  is_active,
});

describe("зарплата — расход с получателем", () => {
  test("что спросить, решает сама категория, а не её имя; флажки независимы", () => {
    assert.deepEqual(
      asksOf({ ask_employee: true, ask_client: true, require_receipt: false }),
      { employee: true, client: true, receipt: false },
    );
    assert.deepEqual(asksOf(null), { employee: false, client: false, receipt: false });
  });

  test("в выборе — свои категории вида, без служебных; скрытая только уже стоящая", () => {
    const cat = (id: string, over: Record<string, unknown> = {}) =>
      ({
        id, tenant_id: "t", slug: id, name: id, type: "expense", icon: null, color: null,
        hidden: false, position: 0, ask_employee: false, ask_client: false,
        require_receipt: false, is_system: false, ...over,
      }) as never;
    const list = [
      cat("fuel"),
      cat("tips", { type: "income" }),
      cat("services", { type: "income", is_system: true, tenant_id: null }),
      cat("old", { hidden: true }),
    ];
    assert.deepEqual(pickableCategories(list, "expense", null).map((c) => c.id), ["fuel"]);
    assert.deepEqual(pickableCategories(list, "expense", "old").map((c) => c.id), ["fuel", "old"]);
    assert.deepEqual(pickableCategories(list, "income", null).map((c) => c.id), ["tips"]);
  });

  test("заголовок с получателем и без", () => {
    assert.equal(withPayee("Зарплата", "Даня"), "Зарплата · Даня");
    assert.equal(withPayee("Зарплата", null), "Зарплата");
    assert.equal(withPayee("Зарплата", "  "), "Зарплата");
  });

  test("сначала люди календаря, потом остальные; уволенный — только если уже выбран", () => {
    const people = [
      p("m3", "Юра", "other"),
      p("m1", "Дима", "yd"),
      p("m2", "Андрей", "yd"),
      p("m4", "Борис", null, false),
    ];
    assert.deepEqual(payeeOptions(people, "yd", null).map((x) => x.id), ["m2", "m1", "m3"]);
    assert.deepEqual(payeeOptions(people, "yd", "m4").map((x) => x.id), ["m2", "m1", "m4", "m3"]);
    assert.deepEqual(payeeOptions(people, null, null).map((x) => x.id), ["m2", "m1", "m3"]);
  });

  test("имя по id; незнакомый id — без имени", () => {
    const people = [p("m1", "Дима", "yd")];
    assert.equal(payeeName(people, "m1"), "Дима");
    assert.equal(payeeName(people, "gone"), null);
    assert.equal(payeeName(undefined, "m1"), null);
    assert.equal(payeeName(people, null), null);
  });
});

describe("подпись строки категорий в настройках", () => {
  const cat = (type: string, over: Record<string, unknown> = {}) =>
    ({
      id: Math.random().toString(36), tenant_id: "t", slug: "x", name: "x", type, icon: null,
      color: null, hidden: false, position: 0, ask_employee: false, ask_client: false,
      require_receipt: false, is_system: false, ...over,
    }) as never;
  test("считает свои по видам, без служебных и скрытых", () => {
    assert.equal(
      categoriesDoorLine([cat("expense"), cat("expense"), cat("income"), cat("income", { is_system: true }), cat("expense", { hidden: true })]),
      "Расход 2 · доход 1",
    );
    assert.equal(categoriesDoorLine([cat("income")]), "Доход 1");
    assert.equal(categoriesDoorLine([]), "Пока нет — создайте свои");
  });
});
