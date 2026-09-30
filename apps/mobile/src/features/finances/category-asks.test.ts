import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  asksOf,
  categoriesDoorLine,
  categoryInTeam,
  payeeName,
  payeeOptions,
  pickableCategories,
  withPayee,
} from "./category-asks";

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

  const cat = (id: string, over: Record<string, unknown> = {}) =>
    ({
      id, tenant_id: "t", team_id: "A", slug: id, name: id, type: "expense", icon: null,
      color: null, hidden: false, position: 0, ask_employee: false, ask_client: false,
      require_receipt: false, is_system: false, monthly_budget: null, ...over,
    }) as never;

  test("в выборе — категории команды этих денег, без служебных; скрытая только уже стоящая", () => {
    const list = [
      cat("fuel"),
      cat("fuel-b", { name: "fuel", team_id: "B" }),
      cat("tips", { type: "income" }),
      cat("services", { type: "income", is_system: true, tenant_id: null, team_id: null }),
      cat("old", { hidden: true }),
    ];
    assert.deepEqual(pickableCategories(list, "expense", null, "A").map((c) => c.id), ["fuel"]);
    assert.deepEqual(pickableCategories(list, "expense", "old", "A").map((c) => c.id), ["fuel", "old"]);
    assert.deepEqual(pickableCategories(list, "income", null, "A").map((c) => c.id), ["tips"]);
    assert.deepEqual(pickableCategories(list, "expense", null, "B").map((c) => c.id), ["fuel-b"]);
    // Команды ещё нет — чужих категорий не предлагаем.
    assert.deepEqual(pickableCategories(list, "expense", null, null), []);
  });

  test("смена команды: та же категория по имени у новой команды или пусто", () => {
    const list = [
      cat("fuel", { name: "Топливо" }),
      cat("fuel-b", { name: " топливо ", team_id: "B" }),
      cat("rent", { name: "Аренда" }),
      cat("services", { type: "income", is_system: true, tenant_id: null, team_id: null }),
    ];
    assert.equal(categoryInTeam(list, "fuel", "B"), "fuel-b");
    assert.equal(categoryInTeam(list, "fuel", "A"), "fuel");
    assert.equal(categoryInTeam(list, "rent", "B"), null);
    assert.equal(categoryInTeam(list, "services", "B"), "services");
    assert.equal(categoryInTeam(list, null, "B"), null);
  });

  test("строка-дверь считает имена, а не копии команд", () => {
    const list = [
      cat("fuel", { name: "Топливо" }),
      cat("fuel-b", { name: "Топливо", team_id: "B" }),
      cat("tips", { type: "income", name: "Чаевые" }),
    ];
    assert.equal(categoriesDoorLine(list), "Расход 1 · доход 1");
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
  let n = 0;
  const cat = (type: string, over: Record<string, unknown> = {}) =>
    ({
      id: `c${++n}`, tenant_id: "t", slug: "x", name: `Категория ${n}`, type, icon: null,
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
