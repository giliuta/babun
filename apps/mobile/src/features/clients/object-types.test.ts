import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import {
  findObjectType,
  objectTypeKey,
  objectTypeVocabulary,
  snapObjectType,
} from "./object-types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// Готовых типов объектов нет: каждый человек сам создаёт свой тип.

describe("словарь типов объекта — только свои типы команды", () => {
  test("пустой справочник — пустой выбор: стандартного набора нет", () => {
    assert.deepEqual(objectTypeVocabulary([]), []);
  });

  test("порядок — порядок справочника", () => {
    assert.deepEqual(objectTypeVocabulary(["Склад", "Цех", "Ресторан"]), ["Склад", "Цех", "Ресторан"]);
  });

  test("регистр и пробелы не плодят дубли, пустые строки выпадают", () => {
    assert.deepEqual(objectTypeVocabulary(["Дом", " дом ", "  ", "ДОМ"]), ["Дом"]);
    assert.equal(objectTypeKey(" ДОМ "), "дом");
  });
});

describe("тип объекта по метке", () => {
  const presets = [{ name: "Офис", color: "#3276FB" }, { name: "Склад" }];

  test("метка находит тип справочника без учёта регистра", () => {
    assert.equal(findObjectType(presets, " офис ")?.color, "#3276FB");
  });

  test("метка удалённого типа — объект без типа", () => {
    assert.equal(findObjectType(presets, "Дом"), undefined);
    assert.equal(findObjectType([], "Офис"), undefined);
  });

  test("пустая метка — без типа", () => {
    assert.equal(findObjectType(presets, ""), undefined);
    assert.equal(findObjectType(presets, null), undefined);
  });
});

describe("готовых типов нет нигде", () => {
  test("ни словарь, ни страница типов, ни ссылка клиенту не подставляют «Дом · Квартира · Офис»", () => {
    // Split screens are read as entry + parts folder (rule of 400 lines).
    const sources: [string, string?][] = [
      ["object-types.ts"],
      ["location-request-form.ts"],
      ["ObjectTypesScreen.tsx", "object-types"],
      ["../../../app/l/[token].tsx", "location-link"],
      ["../../../../../packages/shared/src/local/location-labels.ts"],
    ];
    for (const [path, folder] of sources) {
      const code = readModuleSource(resolve(here, path), folder && resolve(here, folder))
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.doesNotMatch(code, /"Квартира"/, `${path}: вернулся готовый тип`);
      assert.doesNotMatch(code, /Добавить стандартные/, `${path}: вернулась кнопка стандартного набора`);
    }
  });

  test("строка объекта и выбор объекта красят только существующим типом", () => {
    assert.match(
      readModuleSource(resolve(here, "blocks/ObjectsBlock.tsx"), resolve(here, "blocks/objects-block")),
      /findObjectType\(labelPresets, loc\.label\)/,
    );
    assert.match(read("ObjectPickerSheet.tsx"), /findObjectType\(labelPresets, loc\.label\)/);
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
