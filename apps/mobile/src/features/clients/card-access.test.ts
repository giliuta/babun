import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cardAccess, type TeamBlocksOn } from "./card-access";

const ALL_ON: TeamBlocksOn = {
  note: true, people: true, objects: true, labels: true, tags: true, personal: true, files: true, requisites: true,
};
const OWNER = { edit: true, money: true, files: true, links: true };
const MEMBER = { edit: true, money: false, files: true, links: false };

describe("карточка клиента: блоки по команде и по правам", () => {
  test("владелец (нет `blocks`) — всё видит и всё правит", () => {
    const a = cardAccess({ client: {}, caps: OWNER, teamOn: ALL_ON, draft: false });
    for (const key of ["note", "people", "objects", "labels", "personal", "files", "requisites"] as const) {
      assert.deepEqual(a[key], { show: true, edit: true }, key);
    }
    assert.equal(a.money.show, true);
  });

  test("выключенный командой блок не виден даже владельцу", () => {
    const a = cardAccess({ client: {}, caps: OWNER, teamOn: { ...ALL_ON, note: false }, draft: false });
    assert.deepEqual(a.note, { show: false, edit: false });
  });

  test("сотрудник по блокам: Скрыт — нет, Видит — читает, Меняет — правит", () => {
    const client = {
      blocks: {
        clients: "write",
        "clients.note": "read",
        "clients.objects": "write",
        "clients.personal": "off",
        "clients.history": "read",
      },
    };
    const a = cardAccess({ client, caps: MEMBER, teamOn: ALL_ON, draft: false });
    assert.deepEqual(a.note, { show: true, edit: false });
    assert.deepEqual(a.objects, { show: true, edit: true });
    assert.deepEqual(a.personal, { show: false, edit: false });
    assert.equal(a.history.show, true);
    // Деньги идут вместе с «Историей» (03.10): видит историю — видит и долг.
    assert.deepEqual(a.money, { show: true, edit: false });
    const noHistory = cardAccess({
      client: { blocks: { ...client.blocks, "clients.history": "off" } },
      caps: MEMBER,
      teamOn: ALL_ON,
      draft: false,
    });
    assert.equal(noHistory.history.show, false);
    assert.equal(noHistory.money.show, false);
    // Ключа нет — блок скрыт (сервер отдаёт только открытое).
    assert.deepEqual(a.requisites, { show: false, edit: false });
  });

  test("«Меняет» у блока при «Только видит» базы — блок правится, имя и номер нет (02.10)", () => {
    const client = { blocks: { clients: "read", "clients.objects": "write", "clients.note": "read" } };
    const a = cardAccess({ client, caps: MEMBER, teamOn: ALL_ON, draft: false });
    assert.deepEqual(a.objects, { show: true, edit: true });
    assert.deepEqual(a.note, { show: true, edit: false });
    assert.equal(a.card.edit, false);
  });

  test("выключатель команды главнее права", () => {
    const client = { blocks: { clients: "write", "clients.note": "write" } };
    const a = cardAccess({ client, caps: MEMBER, teamOn: { ...ALL_ON, note: false }, draft: false });
    assert.deepEqual(a.note, { show: false, edit: false });
  });

  test("сотрудник без `blocks` (до наката) — как раньше: денег и реквизитов нет", () => {
    const a = cardAccess({ client: {}, caps: MEMBER, teamOn: ALL_ON, draft: false });
    assert.equal(a.money.show, false);
    assert.equal(a.requisites.show, false);
    assert.equal(a.files.show, false);
    assert.equal(a.people.show, false);
    assert.deepEqual(a.note, { show: true, edit: true });
  });

  test("черновик нового клиента — свой, блоки как у владельца", () => {
    const a = cardAccess({ client: null, caps: OWNER, teamOn: ALL_ON, draft: true });
    assert.deepEqual(a.objects, { show: true, edit: true });
    assert.equal(a.card.edit, true);
  });
});

import { statsByBlocks } from "./card-access";

describe("сводка клиента по его правам", () => {
  const stats = {
    visits: 4, totalSpent: 400, lastVisitDate: "2026-09-20", lastVisitDays: 10,
    nextApt: { date: "2026-10-03", time: "13:30" }, nextAptDays: 3, medianGapDays: 30,
    unclosedVisits: 1, debt: 300, expectedRevenue: 80,
  };
  test("владелец — как есть", () => {
    assert.equal(statsByBlocks({}, stats), stats);
  });
  test("с «Историей» — и визиты, и деньги (деньги идут вместе с ней, 03.10)", () => {
    for (const level of ["read", "write"]) {
      const s = statsByBlocks({ blocks: { clients: "read", "clients.history": level } }, stats);
      assert.equal(s.debt, 300, level);
      assert.equal(s.totalSpent, 400, level);
      assert.equal(s.expectedRevenue, 80, level);
      assert.equal(s.visits, 4, level);
    }
  });
  test("без «Истории записей» — ни визитов и дат, ни денег", () => {
    const s = statsByBlocks({ blocks: { clients: "read", "clients.history": "off" } }, stats);
    assert.equal(s.visits, 0);
    assert.equal(s.lastVisitDate, "");
    assert.equal(s.nextApt, null);
    assert.equal(s.debt, 0);
    assert.equal(s.totalSpent, 0);
    assert.equal(s.expectedRevenue, 0);
  });
});
