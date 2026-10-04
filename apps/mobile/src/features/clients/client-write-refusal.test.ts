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
  test("метка и тег — два права; деньги и корзина — дело владельца; действия — своей фразой (03.10)", () => {
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients.labels" }), "Нет права менять «Метка»");
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients.tags" }), "Нет права менять «Тег»");
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients.client" }), "Нет права менять «Клиент»");
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients" }), "Это может только владелец");
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients.delete" }), "Нет права удалять клиентов");
    assert.equal(clientWriteRefusal({ code: "42501", hint: "block:clients.create" }), "Нет права заводить клиентов");
    assert.equal(
      clientWriteRefusal({ code: "23503", hint: "client:tag_other_team" }),
      "Тег другой команды этому клиенту не поставить",
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
