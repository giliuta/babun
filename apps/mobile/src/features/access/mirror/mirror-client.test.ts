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
  shiftMonth,
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
    // «Клиент» скрыт (02.10) — номера нет.
    assert.equal(row.contacts_hidden, "right");
    assert.equal(row.blocks?.clients, "read");
    assert.equal(row.blocks?.["clients.note"], "off");
  });

  test("открытое остаётся; «Меняет» блока — своим правом при «Только видит» базы (02.10)", () => {
    const row = mirrorMemberClient(
      client,
      map({
        A: {
          clients: "read",
          "clients.open": "write",
          "clients.note": "write",
          "clients.labels": "read",
          "clients.client": "read",
        },
      }),
    );
    assert.equal(row.comment, "Код 12");
    assert.equal(row.city, "Лимассол");
    assert.equal(row.blocks?.["clients.note"], "write");
    assert.equal(row.blocks?.clients, "read");
    assert.equal(row.contacts_hidden, null);
    assert.equal(row.phone, "");
  });

  test("команда клиента решает; нет её — самое широкое по командам", () => {
    const m = map({
      A: { clients: "write", "clients.note": "off" },
      B: { clients: "write", "clients.open": "write", "clients.note": "write" },
    });
    assert.equal(mirrorClientBlocks({ team_id: "A" }, m)["clients.note"], "off");
    assert.equal(mirrorClientBlocks({ team_id: "Z" }, m)["clients.note"], "write");
  });

  test("«Открывает карточку» убрано (02.10) — блоки страницы по своим правам, ключа нет", () => {
    const row = mirrorMemberClient(
      client,
      map({ A: { clients: "write", "clients.note": "write", "clients.labels": "read", "clients.history": "read" } }),
    );
    assert.equal(row.blocks?.["clients.open"], undefined);
    assert.equal(row.blocks?.["clients.note"], "write");
    assert.equal(row.comment, "Код 12");
    assert.equal(row.blocks?.["clients.labels"], "read");
    assert.equal(row.blocks?.["clients.history"], "read");
    assert.equal(row.blocks?.clients, "write");
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
    today: TODAY,
    ...input,
  });
  // c1–c3 — клиенты команды A, c4 — команды Z.
  const row = (id: string) => ({ id, team_id: id === "c4" ? "Z" : "A" });
  const ids = (m: MemberAccessMap, input: Partial<MirrorClientData> = {}) => {
    const view = mirrorView(m, data(input));
    return ["c1", "c2", "c3", "c4"].filter((id) => inMirrorView(row(id), view));
  };

  test("без строки — «Неделя»: запись своей команды неделю назад и вперёд", () => {
    const m = map({ A: { clients: "read" } });
    const appointments = [appt("c1", "A", "2026-09-23"), appt("c2", "A", "2026-10-07"), appt("c3", "A", "2026-10-08")];
    assert.deepEqual(ids(m, { appointments }), ["c1", "c2"]);
  });

  test("«3 месяца» и «Полгода» — по календарю", () => {
    const appointments = [appt("c1", "A", "2026-12-30"), appt("c2", "A", "2027-03-30"), appt("c3", "A", "2027-03-31")];
    assert.deepEqual(ids(map({ A: { clients: "read", "clients.scope": "quarter" } }), { appointments }), ["c1"]);
    assert.deepEqual(ids(map({ A: { clients: "read", "clients.scope": "half" } }), { appointments }), ["c1", "c2"]);
  });

  test("«2 недели» — запись своей команды две недели назад и вперёд; отменённая и чужая команда окна не открывают", () => {
    const m = map({ A: { clients: "read", "clients.scope": "near" } });
    const appointments = [
      appt("c1", "A", "2026-09-16"),
      appt("c2", "A", "2026-10-14"),
      appt("c3", "A", "2026-10-15"),
      appt("c3", "A", "2026-09-15"),
      appt("c3", "A", "2026-09-30", "cancelled"),
      appt("c3", "B", "2026-09-30"),
      // c4 — клиент чужой команды: запись в A его в набор не приводит (02.10).
      appt("c4", "A", "2026-09-30"),
    ];
    assert.deepEqual(ids(m, { appointments }), ["c1", "c2"]);
  });

  test("«Месяц» — месяц назад и вперёд, по календарю, как `interval '1 month'`", () => {
    const m = map({ A: { clients: "read", "clients.scope": "month" } });
    const appointments = [
      appt("c1", "A", "2026-08-30"),
      appt("c2", "A", "2026-10-30"),
      appt("c3", "A", "2026-10-31"),
      appt("c3", "A", "2026-08-29"),
    ];
    assert.deepEqual(ids(m, { appointments }), ["c1", "c2"]);
    assert.equal(shiftMonth("2026-03-31", -1), "2026-02-28");
    assert.equal(shiftMonth("2028-03-31", -1), "2028-02-29");
    assert.equal(shiftMonth("2026-12-15", 1), "2027-01-15");
  });

  test("«Без ограничения» — все клиенты команды и только они (02.10)", () => {
    const m = map({ A: { clients: "read", "clients.scope": "own" } });
    assert.deepEqual(ids(m, { appointments: [appt("c4", "A", "2026-09-30")] }), ["c1", "c2", "c3"]);
  });

  test("«Без ограничения» без дня — как хук и зовёт: набор считается, не падает (03.10)", () => {
    // Хук не читает день, когда окон нет; раньше сдвиг пустой строки бросал
    // «Date value out of bounds», и список зеркала был пуст.
    const m = map({ A: { clients: "read", "clients.scope": "own" } });
    assert.deepEqual(ids(m, { today: "" }), ["c1", "c2", "c3"]);
    // Окно без дня — закрыто, а не распахнуто.
    assert.deepEqual(ids(map({ A: { clients: "read", "clients.scope": "week" } }), { today: "" }), []);
  });

  test("база закрыта — никого", () => {
    assert.deepEqual(ids(map({ A: { clients: "off", "clients.scope": "own" } })), []);
  });

  test("блоки и история — по команде клиента", () => {
    const m = map({
      A: { clients: "read", "clients.scope": "own", "clients.history": "read" },
      Z: { clients: "read", "clients.scope": "own", "clients.note": "read" },
    });
    const view = mirrorView(m, data());
    assert.equal(mirrorClientBlocks(row("c1"), m, view)["clients.note"], "off");
    assert.equal(mirrorClientBlocks(row("c4"), m, view)["clients.note"], "read");
    // «История» — своим правом команды клиента (02.10).
    assert.equal(mirrorClientBlocks(row("c1"), m, view)["clients.history"], "read");
    assert.equal(mirrorClientBlocks(row("c4"), m, view)["clients.history"], "off");
  });

  test("номер — у клиента в его наборе с «Клиент: Видит», вне набора — закрыт (02.10)", () => {
    const m = map({ A: { clients: "read", "clients.client": "read" } });
    const view = mirrorView(m, data({ appointments: [appt("c2", "A", "2026-09-25")] }));
    const hidden = (id: string) =>
      mirrorMemberClient({ ...client, ...row(id) } as Client, m, view).contacts_hidden;
    assert.equal(hidden("c2"), null, "в окне команды — номер открывается");
    assert.equal(hidden("c1"), "right", "вне набора — номера нет");
  });

  test("день сдвигается календарём, через конец месяца", () => {
    assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
    assert.equal(shiftDay("2026-03-01", -7), "2026-02-22");
  });
});
