import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { tagWriteWords } from "./tag-write-words";

describe("отказ в правке тега — словами (аудит 03.10)", () => {
  test("нет права — словами, без английского", () => {
    assert.equal(
      tagWriteWords('createClientTag: new row violates row-level security policy for table "client_tags"'),
      "Нет права менять теги этой команды.",
    );
    assert.equal(
      tagWriteWords("updateClientTag: JSON object requested, multiple (or no) rows returned"),
      "Нет права менять теги этой команды.",
    );
  });
  test("повтор имени", () => {
    assert.equal(
      tagWriteWords('createClientTag: duplicate key value violates unique constraint "client_tags_team_name"'),
      "Такой тег у команды уже есть.",
    );
  });
  test("русский отказ сервера — как есть, без приставки", () => {
    assert.equal(
      tagWriteWords("deleteClientTag: Тариф владельца команды закончился — можно только смотреть"),
      "Тариф владельца команды закончился — можно только смотреть",
    );
  });
  test("пусто — про соединение", () => {
    assert.equal(tagWriteWords(""), "Проверьте соединение и попробуйте ещё раз.");
  });
});
