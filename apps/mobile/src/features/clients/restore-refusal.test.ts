import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { restoreRefusalWords } from "./restore-refusal";

describe("причина отказа возврата клиента", () => {
  test("наш русский текст показывается как есть", () => {
    const why = restoreRefusalWords([
      new Error("restoreClient: JWT expired"),
      new Error("Его номер уже у другого клиента — вернуть нельзя, пока номер занят"),
    ]);
    assert.equal(why, "Его номер уже у другого клиента — вернуть нельзя, пока номер занят");
  });

  test("сырой текст сервера не показывается", () => {
    assert.equal(restoreRefusalWords([new Error("restoreClient: network down")]), undefined);
    assert.equal(restoreRefusalWords(["строка"]), undefined);
    assert.equal(restoreRefusalWords([]), undefined);
  });
});
