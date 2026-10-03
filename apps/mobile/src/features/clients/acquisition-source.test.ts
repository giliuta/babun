import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  customSourceId,
  customSourceValue,
  normalizeSource,
  sourceFilterOptions,
  sourceLabel,
  sourcePickerOptions,
  sourcesSummary,
  type ClientSource,
} from "./acquisition-source";

// Свои источники команды (владелец 03.10: «могут самостоятельно добавить
// источник»): готовые ключом, свои — `src:<id>`, удалённый — «Другое».

const src = (id: string, team: string, name: string, position = 0): ClientSource => ({
  id,
  tenant_id: "t1",
  team_id: team,
  name,
  position,
});

const SOURCES = [
  src("a", "team-1", "Facebook", 1),
  src("b", "team-1", "Bazaraki", 0),
  src("c", "team-2", "Партнёр Иван", 0),
];

describe("источник клиента", () => {
  test("значение своего источника и обратно", () => {
    assert.equal(customSourceValue("a"), "src:a");
    assert.equal(customSourceId("src:a"), "a");
    assert.equal(customSourceId("instagram"), null);
    assert.equal(customSourceId("src:"), null);
    assert.equal(customSourceId(null), null);
  });

  test("подпись: готовый, свой, удалённый, пустой", () => {
    assert.equal(sourceLabel("instagram", SOURCES), "Instagram");
    assert.equal(sourceLabel("src:b", SOURCES), "Bazaraki");
    assert.equal(sourceLabel("src:gone", SOURCES), "Другое");
    assert.equal(sourceLabel("unknown", SOURCES), null);
    assert.equal(sourceLabel("", SOURCES), null);
    assert.equal(sourceLabel("tiktok", SOURCES), "Другое");
  });

  test("фильтр видит удалённый свой как «Другое», пустой — как «Неизвестно»", () => {
    assert.equal(normalizeSource("src:gone", SOURCES), "other");
    assert.equal(normalizeSource("src:c", SOURCES), "src:c");
    assert.equal(normalizeSource(undefined, SOURCES), "unknown");
    assert.equal(normalizeSource("referral", SOURCES), "referral");
  });

  test("выбор на карточке: готовые, затем свои команды клиента по порядку", () => {
    const opts = sourcePickerOptions(SOURCES, "team-1");
    assert.equal(opts.length, 10);
    assert.deepEqual(
      opts.slice(-2).map((o) => [o.label, o.value]),
      [
        ["Bazaraki", "src:b"],
        ["Facebook", "src:a"],
      ],
    );
    assert.equal(opts[0].label, "Рекомендация");
    assert.ok(!opts.some((o) => o.value === "unknown"));
    assert.ok(!opts.some((o) => o.label === "Партнёр Иван"), "чужая команда не предлагается");
  });

  test("фильтр: готовые, свои всех команд, «Неизвестно» последним", () => {
    const opts = sourceFilterOptions(SOURCES);
    assert.equal(opts.length, 12);
    assert.equal(opts[opts.length - 1].value, "unknown");
    assert.ok(opts.some((o) => o.value === "src:c"));
  });

  test("подпись строки в шестерёнке", () => {
    assert.equal(sourcesSummary(0), "Только готовые");
    assert.equal(sourcesSummary(1), "Готовые + 1 свой");
    assert.equal(sourcesSummary(3), "Готовые + 3 своих");
    assert.equal(sourcesSummary(11), "Готовые + 11 своих");
    assert.equal(sourcesSummary(21), "Готовые + 21 свой");
  });
});
