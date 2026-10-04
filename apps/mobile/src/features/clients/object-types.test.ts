import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findObjectType,
  objectTypeKey,
  objectTypeVocabulary,
  snapObjectType,
} from "./object-types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

// Владелец 03.10: «удали все типы объектов — изначально их быть не должно,
// каждый человек сам создаёт свой тип объекта».

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
    const sources = [
      "object-types.ts",
      "location-request-form.ts",
      "../reference/screens/ObjectTypesScreen.tsx",
      "../../../app/l/[token].tsx",
      "../../../../../packages/shared/src/local/location-labels.ts",
    ];
    for (const path of sources) {
      const code = read(path)
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.doesNotMatch(code, /"Квартира"/, `${path}: вернулся готовый тип`);
      assert.doesNotMatch(code, /Добавить стандартные/, `${path}: вернулась кнопка стандартного набора`);
    }
  });

  test("строка объекта и выбор объекта красят только существующим типом", () => {
    assert.match(read("blocks/ObjectsBlock.tsx"), /findObjectType\(labelPresets, loc\.label\)/);
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
