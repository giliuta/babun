import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "@/features/access/access-map";
import { recordBlocks } from "./record-blocks";

const TEAM = "team-1";

/** Реестр как на боевой базе 21.09: Команда, Метка, Время ещё не живые. */
const REGISTRY = [
  { key: "record.team", live: false },
  { key: "record.label", live: false },
  { key: "record.when", live: false },
  { key: "record.client", live: true },
  { key: "record.object", live: true },
  { key: "record.services", live: true },
  { key: "record.amount", live: true },
  { key: "record.payment", live: true },
  { key: "record.files", live: true },
  { key: "record.status", live: true },
];

function map(levels: Record<string, "off" | "read" | "write">): MemberAccessMap {
  return {
    tenantId: "tenant-1",
    isOwner: false,
    version: 1,
    company: {},
    calendars: { [TEAM]: levels },
    attachedCalendars: [TEAM],
  };
}

const DMITRY = map({
  "record.client": "read",
  "record.object": "read",
  "record.services": "read",
  "record.amount": "read",
  "record.payment": "write",
  "record.files": "write",
  "record.status": "write",
});

describe("страница записи — одна для всех, блоки по правам", () => {
  test("владелец меняет всё и ничего не ждёт", () => {
    const blocks = recordBlocks({ role: "owner", map: undefined, registry: undefined, teamId: null });
    assert.ok(Object.values(blocks).every((level) => level === "write"));
  });

  test("мастер получает положения своего календаря; неживые блоки — без правки", () => {
    assert.deepEqual(recordBlocks({ role: "master", map: DMITRY, registry: REGISTRY, teamId: TEAM }), {
      team: "read",
      label: "read",
      when: "read",
      client: "read",
      object: "read",
      services: "read",
      amount: "read",
      payment: "write",
      files: "write",
      status: "write",
      note: "write",
    });
  });

  test("закрытый блок исчезает; заметку без статуса только читают", () => {
    const blocks = recordBlocks({
      role: "master",
      map: map({ "record.amount": "off", "record.status": "read" }),
      registry: REGISTRY,
      teamId: TEAM,
    });
    assert.equal(blocks.amount, "hidden");
    assert.equal(blocks.client, "hidden", "нет строки — умолчание «Скрыт»");
    assert.equal(blocks.status, "read");
    assert.equal(blocks.note, "read");
  });

  test("ожил блок — действует его уровень, а не «без правки»", () => {
    const live = REGISTRY.map((b) => (b.key === "record.when" ? { ...b, live: true } : b));
    const blocks = recordBlocks({ role: "master", map: DMITRY, registry: live, teamId: TEAM });
    assert.equal(blocks.when, "hidden");
  });

  test("чужой календарь, запись без календаря, едущая карта — ничего", () => {
    for (const blocks of [
      recordBlocks({ role: "master", map: DMITRY, registry: REGISTRY, teamId: "team-2" }),
      recordBlocks({ role: "master", map: DMITRY, registry: REGISTRY, teamId: null }),
      recordBlocks({ role: "master", map: undefined, registry: REGISTRY, teamId: TEAM }),
      recordBlocks({ role: "master", map: DMITRY, registry: undefined, teamId: TEAM }),
    ]) {
      assert.ok(Object.values(blocks).every((level) => level === "hidden"));
    }
  });
});
