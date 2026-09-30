import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  archivedCalendarIds,
  withoutArchivedCalendars,
} from "./archived-calendar-accounts";

const teams = [
  { id: "live", is_active: true },
  { id: "gone", is_active: false },
];

describe("деньги архивного календаря в живых финансах не существуют", () => {
  test("в архиве — только выключенные календари", () => {
    assert.deepEqual([...archivedCalendarIds(teams)], ["gone"]);
  });

  test("счета архивного календаря уходят, живые и общие остаются", () => {
    const accounts = [
      { id: 1, brigade_id: "live" },
      { id: 2, brigade_id: "gone" },
      { id: 3, brigade_id: null },
      { id: 4 },
    ];
    assert.deepEqual(
      withoutArchivedCalendars(accounts, archivedCalendarIds(teams)).map((a) => a.id),
      [1, 3, 4],
    );
  });

  // Команда, которой в справочнике нет вовсе, — не «архив», а дыра в данных:
  // такой счёт показывается честно («Команда удалена»), а не прячется.
  test("счёт неизвестной команды не прячется", () => {
    const accounts = [{ id: 5, brigade_id: "unknown" }];
    assert.equal(withoutArchivedCalendars(accounts, archivedCalendarIds(teams)).length, 1);
  });

  test("без архива список не меняется и не делит ссылку с входом", () => {
    const accounts = [{ id: 1, brigade_id: "live" }];
    const result = withoutArchivedCalendars(accounts, new Set());
    assert.deepEqual(result, accounts);
    assert.notEqual(result, accounts);
  });
});
