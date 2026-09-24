import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { removalMessage, upcomingWorkCount, type WorkRow } from "./removal-impact";

const TODAY = "2026-09-21";

const row = (over: Partial<WorkRow>): WorkRow => ({
  date: TODAY,
  team_id: "A",
  ...over,
});

describe("сколько работы впереди в календарях человека", () => {
  test("считаем его календари, начиная с сегодня", () => {
    const rows = [
      row({}),
      row({ date: "2026-09-25" }),
      row({ date: "2026-09-20" }), // вчера — уже не подведёт
      row({ team_id: "B", date: "2026-09-25" }), // чужой календарь
      row({ team_id: null, date: "2026-09-25" }),
      row({ kind: "event", date: "2026-09-25" }), // событие — не работа
    ];
    assert.equal(upcomingWorkCount(rows, ["A"], TODAY), 2);
    assert.equal(upcomingWorkCount(rows, ["A", "B"], TODAY), 3);
  });

  test("отменённые не считаются", () => {
    const rows = [row({}), row({ status: "cancelled" }), row({ date: "2026-09-30" })];
    assert.equal(upcomingWorkCount(rows, ["A"], TODAY), 2);
  });

  test("без календарей считать нечего", () => {
    assert.equal(upcomingWorkCount([row({})], [], TODAY), 0);
  });

  test("работы нет — вопрос прежний, без цифры", () => {
    const text = removalMessage(0);
    assert.ok(text.startsWith("Доступ ко всем календарям"));
    assert.ok(!/запис/.test(text));
  });

  test("русский счёт записей", () => {
    assert.match(removalMessage(1), /календарях: 1 запись\./);
    assert.match(removalMessage(2), /календарях: 2 записи\./);
    assert.match(removalMessage(5), /календарях: 5 записей\./);
    assert.match(removalMessage(11), /календарях: 11 записей\./);
    assert.match(removalMessage(21), /календарях: 21 запись\./);
    assert.match(removalMessage(22), /календарях: 22 записи\./);
    assert.match(removalMessage(112), /календарях: 112 записей\./);
  });

  test("цифра стоит ПЕРЕД прежним словом, а не вместо него", () => {
    const text = removalMessage(3);
    assert.ok(text.includes("Впереди в его календарях: 3 записи. Записи останутся в календаре."));
    assert.ok(text.includes("Вернуть можно только новым приглашением"));
  });
});
