import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONNECTION_LOST_MID_SAVE, isNetworkFailure, saveErrorText } from "./save-error";

describe("ошибка сохранения операции", () => {
  test("сырые тексты обрыва связи узнаются", () => {
    for (const message of [
      "Aborted",
      "Network request failed",
      "Failed to fetch",
      "The request timed out.",
      "signal is aborted without reason",
    ]) {
      assert.equal(isNetworkFailure(new Error(message)), true, message);
    }
    const abort = new Error("x");
    abort.name = "AbortError";
    assert.equal(isNetworkFailure(abort), true);
  });

  test("ответ сервера обрывом не считается", () => {
    assert.equal(isNetworkFailure(new Error("Нельзя записать операцию в закрытый счёт")), false);
    assert.equal(isNetworkFailure(new Error("permission denied for table finance_transactions")), false);
  });

  test("обрыв и офлайн говорят одно: проверьте, записалась ли операция", () => {
    assert.deepEqual(saveErrorText(new Error("Aborted"), true), {
      kind: "connection",
      text: CONNECTION_LOST_MID_SAVE,
    });
    assert.equal(saveErrorText(new Error("что угодно"), false).kind, "connection");
  });

  test("отказ сервера доходит до человека своими словами", () => {
    assert.deepEqual(saveErrorText(new Error("Операцию уже удалили на другом устройстве"), true), {
      kind: "server",
      text: "Операцию уже удалили на другом устройстве",
    });
  });
});
