import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  duplicateNameNote,
  findDuplicateName,
  nameKey,
  type NamedAccount,
} from "./account-names";

const acc = (name: string, over: Partial<NamedAccount> = {}): NamedAccount => ({
  name,
  brigade_id: "t1",
  is_active: true,
  ...over,
});

describe("ключ имени счёта", () => {
  test("регистр, пробелы, ё/е и латиница не различают имён", () => {
    assert.equal(nameKey(" Касса "), nameKey("касса"));
    assert.equal(nameKey("Kassa"), nameKey("Касса"));
    assert.equal(nameKey("KARTA"), nameKey("Карта"));
    assert.equal(nameKey("Ёлка"), nameKey("елка"));
    assert.equal(nameKey("Касса   Юры"), nameKey("касса юры"));
  });

  test("повторы символов не схлопываются: «Касса 1», «Касса 11», «Касса 100» — разные", () => {
    assert.notEqual(nameKey("Касса 1"), nameKey("Касса 11"));
    assert.notEqual(nameKey("Касса 10"), nameKey("Касса 100"));
    assert.notEqual(nameKey("Касса"), nameKey("Каса"));
  });

  test("разные слова остаются разными", () => {
    assert.notEqual(nameKey("Касса"), nameKey("Карта"));
    assert.notEqual(nameKey("Касса 2"), nameKey("Касса"));
  });
});

describe("дубль имени", () => {
  const accounts = [acc("Kassa"), acc("Карта", { brigade_id: "t2" })];

  test("то же имя у той же команды — дубль, даже набранное латиницей", () => {
    assert.equal(findDuplicateName(accounts, "касса", "t1")?.name, "Kassa");
  });

  test("то же имя у другой команды — не дубль", () => {
    assert.equal(findDuplicateName(accounts, "Касса", "t2"), null);
    assert.equal(findDuplicateName(accounts, "Карта", "t1"), null);
  });

  test("закрытый счёт держит имя", () => {
    const closed = [acc("Наличные", { is_active: false })];
    assert.equal(findDuplicateName(closed, "наличные", "t1")?.is_active, false);
  });

  test("«Касса 1» рядом с «Касса 11» — не дубль", () => {
    assert.equal(findDuplicateName([acc("Касса 11")], "Касса 1", "t1"), null);
    assert.equal(findDuplicateName([acc("Касса 100")], "Касса 10", "t1"), null);
  });

  test("пустое имя дублем не бывает", () => {
    assert.equal(findDuplicateName([acc("")], "   ", "t1"), null);
  });
});

describe("слова о дубле", () => {
  test("открытый счёт называет команду, закрытый — дорогу к нему", () => {
    assert.match(duplicateNameNote(acc("Касса"), "Юра") ?? "", /У команды «Юра» уже есть счёт «Касса»/);
    assert.match(duplicateNameNote(acc("Касса"), null) ?? "", /^У вас уже есть/);
    assert.match(
      duplicateNameNote(acc("Касса", { is_active: false }), "Юра") ?? "",
      /закрыт.*Откройте его снова/,
    );
    assert.equal(duplicateNameNote(null, "Юра"), null);
  });
});
