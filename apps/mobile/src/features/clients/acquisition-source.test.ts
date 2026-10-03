import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  customSourceId,
  customSourceValue,
  isReferral,
  normalizeSource,
  sourceBucket,
  sourceFilterOptions,
  sourceLabel,
  sourcePickerOptions,
  sourcesSummary,
  type ClientSource,
} from "./acquisition-source";

// Источники — справочник команды (владелец 03.10): готовые засеяны строками
// и правятся, как свои; клиент хранит `src:<id>`, старый ключ готового
// читается строкой своей команды; удалённый — «не указан».

const src = (
  id: string,
  team: string,
  name: string,
  position = 0,
  key: ClientSource["key"] = null,
): ClientSource => ({ id, tenant_id: "t1", team_id: team, name, position, key });

const SOURCES = [
  src("r1", "team-1", "Сарафан", 0, "referral"),
  src("i1", "team-1", "Instagram", 1, "instagram"),
  src("b1", "team-1", "Bazaraki", 2),
  src("i2", "team-2", "Instagram", 0, "instagram"),
  src("o2", "team-2", "Другое", 1, "other"),
];

describe("источник клиента", () => {
  test("значение строки и обратно", () => {
    assert.equal(customSourceValue("a"), "src:a");
    assert.equal(customSourceId("src:a"), "a");
    assert.equal(customSourceId("instagram"), null);
    assert.equal(customSourceId("src:"), null);
  });

  test("подпись: строка, переименованный готовый, старый ключ, удалённый, пустой", () => {
    assert.equal(sourceLabel("src:b1", SOURCES, "team-1"), "Bazaraki");
    assert.equal(sourceLabel("src:r1", SOURCES, "team-1"), "Сарафан");
    assert.equal(sourceLabel("instagram", SOURCES, "team-2"), "Instagram");
    assert.equal(sourceLabel("src:gone", SOURCES, "team-1"), null);
    assert.equal(sourceLabel("unknown", SOURCES, "team-1"), null);
    assert.equal(sourceLabel("", SOURCES, "team-1"), null);
  });

  test("старый ключ без строки у своей команды — не указан", () => {
    // У team-1 «Другое» удалено: импорт с `other` не цепляет чужую команду.
    assert.equal(sourceLabel("other", SOURCES, "team-1"), null);
    assert.equal(normalizeSource("other", SOURCES, "team-1"), "unknown");
    assert.equal(normalizeSource("other", SOURCES, "team-2"), "src:o2");
  });

  test("«Кто привёл» — у засеянной «Рекомендации», как её ни назови", () => {
    assert.equal(isReferral("src:r1", SOURCES, "team-1"), true);
    assert.equal(isReferral("referral", SOURCES, "team-1"), true);
    assert.equal(isReferral("src:b1", SOURCES, "team-1"), false);
  });

  test("выбор на карточке — источники команды клиента по порядку", () => {
    const opts = sourcePickerOptions(SOURCES, "team-1");
    assert.deepEqual(
      opts.map((o) => [o.label, o.value]),
      [
        ["Сарафан", "src:r1"],
        ["Instagram", "src:i1"],
        ["Bazaraki", "src:b1"],
      ],
    );
  });

  test("фильтр: одно имя — один вариант на все команды, «Неизвестно» последним", () => {
    const all = sourceFilterOptions(SOURCES);
    assert.equal(all.filter((o) => o.label === "Instagram").length, 1);
    assert.equal(all[all.length - 1].value, "unknown");
    assert.equal(sourceBucket("src:i1", SOURCES, "team-1"), sourceBucket("src:i2", SOURCES, "team-2"));
    assert.equal(sourceBucket("src:gone", SOURCES, "team-1"), "unknown");
  });

  test("фильтр под чипом — только источники его команды", () => {
    const labels = sourceFilterOptions(SOURCES, "team-2").map((o) => o.label);
    assert.deepEqual(labels, ["Instagram", "Другое", "Неизвестно"]);
  });

  test("подпись строки в шестерёнке", () => {
    assert.equal(sourcesSummary(0), "Источников нет");
    assert.equal(sourcesSummary(1), "1 источник");
    assert.equal(sourcesSummary(3), "3 источника");
    assert.equal(sourcesSummary(8), "8 источников");
    assert.equal(sourcesSummary(21), "21 источник");
  });
});
