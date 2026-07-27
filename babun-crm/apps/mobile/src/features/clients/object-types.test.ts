import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  appendOnly,
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
    assert.deepEqual(objectTypeVocabulary([]), ["Дом", "Квартира", "Офис"]);
  });

  test("типы из настроек идут ПЕРВЫМИ, в порядке настроек", () => {
    // Бизнес объявил свой список — он и есть главный.
    const vocab = objectTypeVocabulary([client("Ресторан")], ["Склад", "Цех"]);
    assert.deepEqual(vocab, [
      "Склад",
      "Цех",
      "Ресторан",
      "Дом",
      "Квартира",
      "Офис",
    ]);
  });

  test("используемое бизнесом идёт ПЕРЕД стандартным", () => {
    const vocab = objectTypeVocabulary([
      client("Квартира", "Квартира"),
      client("Ресторан"),
    ]);
    assert.deepEqual(vocab, ["Квартира", "Ресторан", "Дом", "Офис"]);
  });

  test("регистр и пробелы не плодят дубли", () => {
    const vocab = objectTypeVocabulary([client("дом", "Дом ", " ДОМ")]);
    assert.deepEqual(vocab, ["дом", "Квартира", "Офис"]);
    assert.equal(objectTypeKey(" ДОМ "), "дом");
  });

  test("ПОРЯДОК НЕ ЗАВИСИТ ОТ ВЫБОРА — чип не уезжает из-под пальца", () => {
    // Баг, который владелец увидел первым тапом: выбор «Офиса» пересобирал
    // список, и выбранным оказывался сосед.
    const clients = [client("Квартира", "Квартира"), client("Ресторан")];
    const before = objectTypeVocabulary(clients, []);
    for (const picked of before) {
      assert.deepEqual(
        objectTypeVocabulary(clients, [], picked),
        before,
        `выбор «${picked}» переставил список`,
      );
    }
  });

  test("текущее значение дописывается В КОНЕЦ, если его нигде нет", () => {
    const vocab = objectTypeVocabulary([], [], "Ангар");
    assert.deepEqual(vocab, ["Дом", "Квартира", "Офис", "Ангар"]);
  });

  test("пустые и пробельные метки игнорируются", () => {
    assert.deepEqual(objectTypeVocabulary([client("", "   ")]), [
      "Дом",
      "Квартира",
      "Офис",
    ]);
  });
});

describe("защита пальца: словарь только дописывается", () => {
  test("ЗАПИСЬ выбора не переставляет уже показанные чипы", () => {
    // Реальный контур: тап по чипу переписывает метку объекта, то есть меняет
    // ЧАСТОТЫ, из которых строится порядок. Чистый словарь обязан на это
    // отреагировать — а экран обязан НЕ переставлять то, во что уже целится
    // палец. За это отвечает appendOnly (аудит 2026-07-27).
    const clients = [
      client("Квартира", "Квартира"),
      client("Ресторан"),
      client("Дом"),
    ];
    const shown = objectTypeVocabulary(clients, []);
    for (const picked of shown) {
      const afterWrite = objectTypeVocabulary(
        [
          { locations: [{ label: picked }, { label: "Квартира" }] } as never,
          ...clients.slice(1),
        ],
        [],
        picked,
      );
      const next = appendOnly(shown, afterWrite);
      assert.deepEqual(
        next.slice(0, shown.length),
        shown,
        `выбор «${picked}» переставил уже показанные чипы`,
      );
    }
  });

  test("новое значение дописывается в хвост, дубли по регистру не плодятся", () => {
    assert.deepEqual(appendOnly(["Дом", "Офис"], ["дом", "Склад", " СКЛАД "]), [
      "Дом",
      "Офис",
      "Склад",
    ]);
  });

  test("нечего дописывать — возвращается ТОТ ЖЕ массив", () => {
    const shown = ["Дом", "Офис"];
    assert.equal(appendOnly(shown, ["Дом"]), shown);
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
