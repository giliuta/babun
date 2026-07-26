import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  defaultObjectType,
  objectTypeKey,
  objectTypeVocabulary,
  snapObjectType,
} from "./object-types";

type Loc = { label: string };
const client = (...labels: string[]) =>
  ({ locations: labels.map((label): Loc => ({ label })) }) as never;

describe("словарь типов объекта", () => {
  test("пустая база — только стандартный набор", () => {
    assert.deepEqual(objectTypeVocabulary([]), ["Дом", "Офис", "Вилла"]);
  });

  test("используемое бизнесом идёт ПЕРЕД стандартным", () => {
    // У кондиционерщика «Квартира» встречается чаще всего — она и первая,
    // а наш «Дом» стоит после того, чем реально пользуются.
    const vocab = objectTypeVocabulary([
      client("Квартира", "Квартира"),
      client("Ресторан"),
    ]);
    assert.deepEqual(vocab, ["Квартира", "Ресторан", "Дом", "Офис", "Вилла"]);
  });

  test("регистр и пробелы не плодят дубли", () => {
    const vocab = objectTypeVocabulary([client("дом", "Дом ", " ДОМ")]);
    assert.deepEqual(vocab, ["дом", "Офис", "Вилла"]);
    assert.equal(objectTypeKey(" ДОМ "), "дом");
  });

  test("текущее значение объекта попадает в список, даже если больше нигде нет", () => {
    const vocab = objectTypeVocabulary([], ["Склад"]);
    assert.deepEqual(vocab, ["Склад", "Дом", "Офис", "Вилла"]);
  });

  test("обязательные значения не обгоняют используемые", () => {
    const vocab = objectTypeVocabulary([client("Офис", "Офис")], ["Склад"]);
    assert.equal(vocab[0], "Офис");
    assert.ok(vocab.includes("Склад"));
  });

  test("пустые и пробельные метки игнорируются", () => {
    assert.deepEqual(objectTypeVocabulary([client("", "   ")]), [
      "Дом",
      "Офис",
      "Вилла",
    ]);
  });
});

describe("подстановка типа новому объекту", () => {
  test("берётся тип основного объекта этого же клиента", () => {
    const c = {
      locations: [
        { label: "Офис", isPrimary: false },
        { label: "Вилла", isPrimary: true },
      ],
    };
    assert.equal(defaultObjectType(c as never, ["Дом"]), "Вилла");
  });

  test("заглушка «Объект» за тип не считается", () => {
    const c = { locations: [{ label: "Объект", isPrimary: true }] };
    assert.equal(defaultObjectType(c as never, ["Квартира"]), "Квартира");
  });

  test("у нового клиента — первый тип словаря", () => {
    assert.equal(defaultObjectType(null, ["Квартира", "Дом"]), "Квартира");
  });

  test("совсем ничего — «Дом»", () => {
    assert.equal(defaultObjectType(null, []), "Дом");
  });
});

describe("нормализация своего типа", () => {
  test("подхватывает существующее написание", () => {
    assert.equal(snapObjectType(" дом ", ["Дом", "Офис"]), "Дом");
  });

  test("новое значение чистится от лишних пробелов", () => {
    assert.equal(snapObjectType("  Торговый   центр ", ["Дом"]), "Торговый центр");
  });

  test("пустой ввод — пустая строка", () => {
    assert.equal(snapObjectType("   ", ["Дом"]), "");
  });
});
