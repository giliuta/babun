import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { eventTitleIsNote, recordComment } from "./record-title";

describe("заголовок записи без клиента", () => {
  test("событие с типом называется типом", () => {
    assert.equal(recordComment({ kind: "event", comment: "Обед", event_notes: "к маме" }), "Обед");
    assert.equal(eventTitleIsNote({ kind: "event", comment: "Обед", event_notes: "к маме" }), false);
  });
  test("событие без типа называется первой строкой заметки", () => {
    const a = { kind: "event", comment: "Событие", event_notes: "Забрать фреон\nу Андрея" };
    assert.equal(recordComment(a), "Забрать фреон");
    assert.equal(eventTitleIsNote(a), true);
  });
  test("пустое событие остаётся «Событие»", () => {
    assert.equal(recordComment({ kind: "event", comment: "Событие", event_notes: " " }), "Событие");
  });
  test("работа — её комментарий, заметка события ни при чём", () => {
    assert.equal(recordComment({ kind: "work", comment: "звонить", event_notes: "x" }), "звонить");
  });
});
