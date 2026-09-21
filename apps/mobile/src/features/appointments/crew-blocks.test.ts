import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "@/features/access/access-map";
import { crewAddress, crewBlocks } from "./crew-blocks";

const TEAM = "team-1";
const OTHER = "team-2";

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

const MIXED = map({
  "record.status": "write",
  "record.files": "read",
  "record.client": "read",
  "record.object": "off",
  "record.services": "read",
  "record.amount": "off",
  "record.payment": "read",
});

describe("карточка записи у команды спрашивает права календаря записи", () => {
  test("владелец видит и меняет всё, карту не ждёт", () => {
    assert.deepEqual(crewBlocks({ role: "owner", map: undefined, teamId: TEAM }), {
      status: "write",
      files: "write",
      client: true,
      object: true,
      services: true,
      amount: true,
      payment: "write",
    });
  });

  test("мастер получает ровно положения своего календаря", () => {
    assert.deepEqual(crewBlocks({ role: "master", map: MIXED, teamId: TEAM }), {
      status: "write",
      files: "read",
      client: true,
      object: false,
      services: true,
      amount: false,
      payment: "read",
    });
  });

  test("в чужом календаре — ничего, даже если в своём можно всё", () => {
    assert.deepEqual(crewBlocks({ role: "master", map: MIXED, teamId: OTHER }), {
      status: "hidden",
      files: "hidden",
      client: false,
      object: false,
      services: false,
      amount: false,
      payment: "hidden",
    });
  });

  test("запись без календаря закрыта сотруднику и открыта владельцу", () => {
    assert.equal(crewBlocks({ role: "master", map: MIXED, teamId: null }).client, false);
    assert.equal(crewBlocks({ role: "master", map: MIXED, teamId: null }).status, "hidden");
    assert.equal(crewBlocks({ role: "owner", map: undefined, teamId: null }).status, "write");
  });

  test("пока карта едет — закрыто, а не «всё можно»", () => {
    assert.deepEqual(crewBlocks({ role: "master", map: undefined, teamId: TEAM }), {
      status: "hidden",
      files: "hidden",
      client: false,
      object: false,
      services: false,
      amount: false,
      payment: "hidden",
    });
    assert.equal(crewBlocks({ role: undefined, map: MIXED, teamId: TEAM }).files, "hidden");
  });
});

describe("адрес выезда держится блока «Объект в записи»", () => {
  const open = { client: true, object: true };

  test("объект закрыт — адреса нет ни из записи, ни из карточки клиента", () => {
    assert.equal(crewAddress("Limassol, Agiou 5", "Paphos 1", { client: true, object: false }), "");
    assert.equal(crewAddress("", "Paphos 1", { client: true, object: false }), "");
  });

  test("клиент закрыт — его адрес не подставляется другой дорогой", () => {
    assert.equal(crewAddress("", "Paphos 1", { client: false, object: true }), "");
    assert.equal(crewAddress("Limassol", "Paphos 1", { client: false, object: true }), "Limassol");
  });

  test("всё открыто — адрес записи, иначе клиента, без пробелов по краям", () => {
    assert.equal(crewAddress("  Limassol  ", "Paphos 1", open), "Limassol");
    assert.equal(crewAddress("", " Paphos 1 ", open), "Paphos 1");
    assert.equal(crewAddress("", null, open), "");
  });
});
