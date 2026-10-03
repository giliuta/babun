import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TeamDesign } from "./team-design";
import { changedDesignColumns } from "./team-design-columns";

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
