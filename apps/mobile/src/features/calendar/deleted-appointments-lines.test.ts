import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canRestoreDeleted, deletedAppointmentsDoorLine } from "./deleted-appointments-lines";

describe("deletedAppointmentsDoorLine", () => {
  test("пусто — словом, иначе число с формой", () => {
    assert.equal(deletedAppointmentsDoorLine(0), "Пусто");
    assert.equal(deletedAppointmentsDoorLine(1), "1 запись");
    assert.equal(deletedAppointmentsDoorLine(3), "3 записи");
    assert.equal(deletedAppointmentsDoorLine(5), "5 записей");
  });
});

describe("canRestoreDeleted", () => {
  test("рабочая запись — любому, кто её видит в ящике", () => {
    assert.equal(canRestoreDeleted({ kind: "work", createdBy: "a" }, "b"), true);
  });
  test("событие — только автору", () => {
    assert.equal(canRestoreDeleted({ kind: "event", createdBy: "a" }, "a"), true);
    assert.equal(canRestoreDeleted({ kind: "event", createdBy: "a" }, "b"), false);
    assert.equal(canRestoreDeleted({ kind: "event", createdBy: null }, null), false);
  });
});
