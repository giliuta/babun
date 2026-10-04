import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clientBlockLevel, parseClientBlocks } from "./client-block-access";

describe("блоки карточки клиента по правам", () => {
  test("строка владельца (без blocks) — всё открыто", () => {
    assert.equal(clientBlockLevel({}, "clients.note"), "write");
    assert.equal(clientBlockLevel(null, "clients.files"), "write");
  });

  test("строка сотрудника — как сказал сервер; нет ключа — блока нет", () => {
    const client = { blocks: { clients: "read", "clients.note": "read", "clients.files": "off" } };
    assert.equal(clientBlockLevel(client, "clients.note"), "read");
    assert.equal(clientBlockLevel(client, "clients.files"), "hidden");
    assert.equal(clientBlockLevel(client, "clients.history"), "hidden");
    assert.equal(clientBlockLevel({ blocks: { "clients.objects": "write" } }, "clients.objects"), "write");
  });

  test("разбор blocks: только знакомые положения", () => {
    assert.deepEqual(parseClientBlocks({ clients: "write", "clients.note": "all", x: 1 }), { clients: "write" });
    assert.equal(parseClientBlocks(null), undefined);
    assert.equal(parseClientBlocks(["off"]), undefined);
  });
});
