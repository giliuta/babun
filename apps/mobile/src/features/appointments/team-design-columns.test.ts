import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TeamDesign } from "./team-design";
import { changedDesignColumns, rebaseDesign } from "./team-design-columns";

// ПРАВКА НАСТРОЕК КОМАНДЫ УНОСИТ ТОЛЬКО СВОЁ (01.10): у каждой части строки
// `team_design` своё право, и чужая колонка из кэша телефона либо отбивается
// сервером, либо молча возвращает назад свежую правку владельца.

const base: TeamDesign = {
  rule: "team",
  palette: null,
  fallback: null,
  disabledBlocks: ["event_note"],
  listOff: null,
  contactWays: { enabled: ["phone"], order: ["phone"] },
  mapServices: null,
};

describe("разница правки настроек команды", () => {
  test("способы связи — уходит одна колонка", () => {
    const next = { ...base, contactWays: { enabled: ["phone", "whatsapp"], order: ["phone", "whatsapp"] } };
    assert.deepEqual(Object.keys(changedDesignColumns(base, next)), ["contact_ways"]);
  });

  test("блок карточки клиента — уходят только выключенные блоки", () => {
    const next = { ...base, disabledBlocks: ["event_note", "client_note"] as TeamDesign["disabledBlocks"] };
    assert.deepEqual(changedDesignColumns(base, next), { disabled_blocks: ["event_note", "client_note"] });
  });

  test("ничего не поменялось — уходить нечему", () => {
    assert.deepEqual(changedDesignColumns(base, { ...base }), {});
  });

  test("пустое и отсутствующее — одно и то же", () => {
    assert.deepEqual(changedDesignColumns({ ...base, listOff: undefined }, { ...base, listOff: null }), {});
  });
});

// ПРАВКА ОТ УСТАРЕВШЕЙ ОСНОВЫ НЕ ЗАТИРАЕТ СТРОКУ СЕРВЕРА (04.10): у телефона
// не было строки команды, экран показывал умолчания, и запись целой строкой
// стирала «Способы связи», «Карты» и выключенные блоки, заведённые раньше.
describe("правка ложится на строку сервера", () => {
  const defaults: TeamDesign = {
    rule: "team",
    palette: null,
    fallback: null,
    disabledBlocks: [],
    listOff: null,
    contactWays: null,
    mapServices: null,
  };
  const server: TeamDesign = {
    rule: "service",
    palette: null,
    fallback: "#123456",
    disabledBlocks: ["record_note"],
    listOff: ["phone"],
    contactWays: { enabled: ["phone", "whatsapp"], order: ["phone", "whatsapp"] },
    mapServices: { enabled: ["google"], order: ["google", "waze"] },
  };

  test("тумблер блока от умолчаний добавляет блок, не стирая чужие", () => {
    const next = { ...defaults, disabledBlocks: ["record_files"] as TeamDesign["disabledBlocks"] };
    const out = rebaseDesign(defaults, next, server);
    assert.deepEqual(out.disabledBlocks, ["record_note", "record_files"]);
    assert.deepEqual(out.contactWays, server.contactWays);
    assert.deepEqual(out.mapServices, server.mapServices);
    assert.equal(out.rule, "service");
    assert.equal(out.fallback, "#123456");
    assert.deepEqual(changedDesignColumns(server, out), { disabled_blocks: ["record_note", "record_files"] });
  });

  test("включённый обратно блок убирается из набора сервера", () => {
    const shown = { ...defaults, disabledBlocks: ["record_note"] as TeamDesign["disabledBlocks"] };
    const next = { ...defaults, disabledBlocks: [] as TeamDesign["disabledBlocks"] };
    assert.deepEqual(rebaseDesign(shown, next, server).disabledBlocks, []);
  });

  test("изменённое поле берётся из правки, остальные — с сервера", () => {
    const next = { ...defaults, rule: "label" as TeamDesign["rule"] };
    const out = rebaseDesign(defaults, next, server);
    assert.deepEqual(changedDesignColumns(server, out), { record_color_rule: "label" });
  });

  test("без изменений строка сервера не трогается", () => {
    assert.deepEqual(changedDesignColumns(server, rebaseDesign(defaults, { ...defaults }, server)), {});
  });
});
