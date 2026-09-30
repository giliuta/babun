import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { clientWriteRefusal } from "@babun/shared/db/repositories/clients";

describe("отказ сервера по правке клиента — словами", () => {
  test("закрытый блок называет блок", () => {
    assert.equal(
      clientWriteRefusal({ code: "42501", hint: "block:clients.note" }),
      "Нет права менять «Заметка»",
    );
    assert.equal(
      clientWriteRefusal({ code: "42501", hint: "block:clients.people" }),
      "Нет права менять «Люди»",
    );
  });
  test("закрытый номер — сначала открыть", () => {
    assert.equal(clientWriteRefusal({ code: "42501", hint: "access:contacts_closed" }), "Сначала откройте номер");
  });
  test("клиент вне набора", () => {
    assert.equal(clientWriteRefusal({ code: "P0002", message: "client not found" }), "Клиент недоступен");
  });
  test("чужое — как было", () => {
    assert.equal(clientWriteRefusal({ code: "23505", message: "duplicate key" }), null);
  });
});
