import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Client } from "@babun/shared/local/clients";
import type { MemberAccessMap } from "../access-map";
import {
  inMirrorView,
  mirrorClientBlocks,
  mirrorMemberClient,
  mirrorView,
  shiftDay,
  type MirrorClientData,
} from "./mirror-client";

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

describe("зеркало: какие клиенты в его наборе (как `access_client_ids_in`)", () => {
  const TODAY = "2026-09-30";
  const appt = (client_id: string, team_id: string, date: string, status = "scheduled") => ({
    client_id,
    team_id,
    date,
    status,
  });
  const data = (input: Partial<MirrorClientData> = {}): MirrorClientData => ({
    appointments: [],
    createdBy: [],
    today: TODAY,
    ...input,
  });
  // c4 — клиент команды A, остальные — команды Z.
  const row = (id: string) => ({ id, team_id: id === "c4" ? "A" : "Z" });
  const ids = (m: MemberAccessMap, input: Partial<MirrorClientData> = {}) => {
    const view = mirrorView(m, data(input));
    return ["c1", "c2", "c3", "c4"].filter((id) => inMirrorView(row(id), view));
  };

  test("«Около записи» — неделя назад и завтра; отменённая и чужая команда окна не открывают", () => {
    const m = map({ A: { clients: "read" } });
    const appointments = [
      appt("c1", "A", "2026-09-23"),
      appt("c2", "A", "2026-10-01"),
      appt("c3", "A", "2026-10-02"),
      appt("c3", "A", "2026-09-22"),
      appt("c4", "A", "2026-09-30", "cancelled"),
      appt("c4", "B", "2026-09-30"),
    ];
    assert.deepEqual(ids(m, { appointments }), ["c1", "c2"]);
  });

  test("«Своей команды» — клиенты команды и её записи за всё время", () => {
    const m = map({ A: { clients: "read", "clients.scope": "own" } });
    assert.deepEqual(ids(m, { appointments: [appt("c2", "A", "2020-01-01", "cancelled")] }), ["c2", "c4"]);
  });

  test("«Вся база» хоть в одной команде — вся база", () => {
    const m = map({ A: { clients: "read" }, B: { clients: "read", "clients.scope": "all" } });
    assert.deepEqual(ids(m), ["c1", "c2", "c3", "c4"]);
  });

  test("завёл сам — видит всегда; карточки закрыты везде — никого", () => {
    assert.deepEqual(ids(map({ A: { clients: "read" } }), { createdBy: ["c3"] }), ["c3"]);
    assert.deepEqual(
      ids(map({ A: { clients: "off", "clients.scope": "all" } }), { createdBy: ["c3"] }),
      [],
    );
  });

  test("блоки — самые широкие по командам, ЧЕРЕЗ КОТОРЫЕ клиент виден", () => {
    // Вся база в A без заметки; в B заметка открыта, но c1 в окне B нет.
    const m = map({
      A: { clients: "read", "clients.scope": "all" },
      B: { clients: "read", "clients.note": "read" },
    });
    const view = mirrorView(m, data({ appointments: [appt("c2", "B", TODAY)] }));
    assert.equal(mirrorClientBlocks(row("c1"), m, view)["clients.note"], "off");
    assert.equal(mirrorClientBlocks(row("c2"), m, view)["clients.note"], "read");
  });

  test("номер: «Всегда» — только в наборе своей команды; «В день записи» — запись сегодня", () => {
    const m = map({
      A: { clients: "read", "clients.scope": "all" },
      B: { clients: "read", "clients.contacts": "read" },
      C: { clients: "read", "clients.contacts": "day" },
    });
    const view = mirrorView(
      m,
      data({
        appointments: [
          appt("c2", "B", "2026-09-25"),
          appt("c3", "C", TODAY),
          appt("c4", "C", "2026-10-01"),
        ],
      }),
    );
    const hidden = (id: string) =>
      mirrorMemberClient({ ...client, ...row(id) } as Client, m, view).contacts_hidden;
    assert.equal(hidden("c1"), "right", "виден только через «Вся база» без телефонов");
    assert.equal(hidden("c2"), null, "в окне команды с «Всегда»");
    assert.equal(hidden("c3"), null, "запись сегодня в команде «В день записи»");
    assert.equal(hidden("c4"), "day", "запись завтра — номер откроется в день записи");
  });

  test("день сдвигается календарём, через конец месяца", () => {
    assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
    assert.equal(shiftDay("2026-03-01", -7), "2026-02-22");
  });
});
