import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { removalMessage, upcomingWorkCount, type WorkRow } from "./removal-impact";

const MASTER = "master-1";
const OTHER = "master-2";
const TODAY = "2026-09-21";

const row = (over: Partial<WorkRow>): WorkRow => ({
  date: TODAY,
  master_id: MASTER,
  ...over,
});

describe("сколько работы останется, если убрать человека", () => {
  test("считаем его, начиная с сегодня", () => {
    const rows = [
      row({}),
      row({ date: "2026-09-25" }),
      row({ date: "2026-09-20" }), // вчера — уже не подведёт
      row({ master_id: OTHER, date: "2026-09-25" }),
      row({ master_id: null, date: "2026-09-25" }),
    ];
    assert.equal(upcomingWorkCount(rows, MASTER, TODAY), 2);
  });

  test("отменённые не считаются", () => {
    const rows = [row({}), row({ status: "cancelled" }), row({ date: "2026-09-30" })];
    assert.equal(upcomingWorkCount(rows, MASTER, TODAY), 2);
  });

  test("человек без карточки мастера — считать нечего", () => {
    assert.equal(upcomingWorkCount([row({})], null, TODAY), 0);
    assert.equal(upcomingWorkCount([row({})], undefined, TODAY), 0);
  });

  test("работы нет — вопрос прежний, без цифры", () => {
    const text = removalMessage(0);
    assert.ok(text.startsWith("Доступ ко всем календарям"));
    assert.ok(!/\d/.test(text.replace(/[^0-9]/g, "")) || !/запис/.test(text));
  });

  test("русский счёт записей", () => {
    assert.match(removalMessage(1), /^1 запись останутся|^1 запись/);
    assert.match(removalMessage(2), /^2 записи/);
    assert.match(removalMessage(5), /^5 записей/);
    assert.match(removalMessage(11), /^11 записей/);
    assert.match(removalMessage(21), /^21 запись/);
    assert.match(removalMessage(22), /^22 записи/);
    assert.match(removalMessage(112), /^112 записей/);
  });

  test("цифра стоит ПЕРЕД прежним словом, а не вместо него", () => {
    const text = removalMessage(3);
    assert.ok(text.includes("3 записи останутся в календаре"));
    assert.ok(text.includes("Вернуть можно только новым приглашением"));
  });
});
