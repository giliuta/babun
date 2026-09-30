import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Client } from "@babun/shared/local/clients";
import type { MemberAccessMap } from "../access-map";
import { mirrorClientBlocks, mirrorMemberClient } from "./mirror-client";

const map = (calendars: MemberAccessMap["calendars"]): MemberAccessMap => ({
  tenantId: "t",
  isOwner: false,
  version: 1,
  company: {},
  calendars,
  attachedCalendars: Object.keys(calendars),
});

const client = {
  id: "c1",
  team_id: "A",
  full_name: "Анна",
  phone: "+35799000000",
  comment: "Код 12",
  notes: [{ id: "n" }],
  locations: [{ id: "l" }],
  city: "Лимассол",
  tag_ids: ["t1"],
  birthday: "1990-05-01",
  legal_name: "Ltd",
  balance: 30,
  memberships: [{ group_id: "g" }],
} as unknown as Client;

describe("зеркало: строка клиента глазами сотрудника", () => {
  test("всё закрыто — только имя, контактов нет, blocks скажут «скрыто»", () => {
    const row = mirrorMemberClient(client, map({ A: { clients: "read" } }));
    assert.equal(row.full_name, "Анна");
    assert.equal(row.phone, "");
    assert.equal(row.comment, "");
    assert.deepEqual(row.locations, []);
    assert.equal(row.city, "");
    assert.equal(row.birthday, "");
    assert.equal(row.legal_name, null);
    assert.equal(row.balance, 0);
    assert.deepEqual(row.memberships, []);
    assert.equal(row.contacts_hidden, "right");
    assert.equal(row.blocks?.clients, "read");
    assert.equal(row.blocks?.["clients.note"], "off");
  });

  test("открытое остаётся; «Меняет» блока при «Только видит» карточки — «Видит»", () => {
    const row = mirrorMemberClient(
      client,
      map({ A: { clients: "read", "clients.note": "write", "clients.labels": "read", "clients.contacts": "day" } }),
    );
    assert.equal(row.comment, "Код 12");
    assert.equal(row.city, "Лимассол");
    assert.equal(row.blocks?.["clients.note"], "read");
    assert.equal(row.contacts_hidden, "day");
    assert.equal(row.phone, "");
  });

  test("команда клиента решает; нет её — самое широкое по командам", () => {
    const m = map({ A: { clients: "write", "clients.note": "off" }, B: { clients: "write", "clients.note": "write" } });
    assert.equal(mirrorClientBlocks({ team_id: "A" }, m)["clients.note"], "off");
    assert.equal(mirrorClientBlocks({ team_id: "Z" }, m)["clients.note"], "write");
  });
});
