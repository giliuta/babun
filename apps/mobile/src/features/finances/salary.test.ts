import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isSalaryCategory, payeeName, payeeOptions, withPayee } from "./salary";

const p = (id: string, full_name: string, team_id: string | null, is_active = true) => ({
  id,
  full_name,
  team_id,
  is_active,
});

describe("зарплата — расход с получателем", () => {
  test("категорию зарплаты узнаём по slug, а не по имени", () => {
    assert.equal(isSalaryCategory({ slug: "salary" }), true);
    assert.equal(isSalaryCategory({ slug: "fuel" }), false);
    assert.equal(isSalaryCategory(null), false);
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
