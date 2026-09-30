import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cardAccess, type TeamBlocksOn } from "./card-access";

const ALL_ON: TeamBlocksOn = {
  note: true, people: true, objects: true, labels: true, personal: true, files: true, requisites: true,
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
        "clients.money": "off",
        "clients.history": "read",
      },
    };
    const a = cardAccess({ client, caps: MEMBER, teamOn: ALL_ON, draft: false });
    assert.deepEqual(a.note, { show: true, edit: false });
    assert.deepEqual(a.objects, { show: true, edit: true });
    assert.deepEqual(a.personal, { show: false, edit: false });
    assert.equal(a.money.show, false);
    assert.equal(a.history.show, true);
    // Ключа нет — блок скрыт (сервер отдаёт только открытое).
    assert.deepEqual(a.requisites, { show: false, edit: false });
  });

  test("«Меняет» у блока без «Меняет» у карточки — только чтение", () => {
    const client = { blocks: { clients: "read", "clients.objects": "write" } };
    const a = cardAccess({ client, caps: MEMBER, teamOn: ALL_ON, draft: false });
    assert.deepEqual(a.objects, { show: true, edit: false });
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
