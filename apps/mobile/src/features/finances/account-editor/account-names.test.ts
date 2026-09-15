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
  test("регистр, пробелы по краям, латиница и сдвоенные буквы не различают имён", () => {
    assert.equal(nameKey(" Касса "), nameKey("касса"));
    assert.equal(nameKey("Kasa"), nameKey("Касса"));
    assert.equal(nameKey("KARTA"), nameKey("Карта"));
  });

  test("разные слова остаются разными", () => {
    assert.notEqual(nameKey("Касса"), nameKey("Карта"));
    assert.notEqual(nameKey("Касса 2"), nameKey("Касса"));
  });
});

describe("дубль имени", () => {
  const accounts = [acc("Kasa"), acc("Карта", { brigade_id: "t2" })];

  test("то же имя у той же команды — дубль, даже набранное латиницей", () => {
    assert.equal(findDuplicateName(accounts, "касса", "t1")?.name, "Kasa");
  });

  test("то же имя у другой команды — не дубль", () => {
    assert.equal(findDuplicateName(accounts, "Касса", "t2"), null);
    assert.equal(findDuplicateName(accounts, "Карта", "t1"), null);
  });

  test("закрытый счёт держит имя", () => {
    const closed = [acc("Наличные", { is_active: false })];
    assert.equal(findDuplicateName(closed, "наличные", "t1")?.is_active, false);
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
