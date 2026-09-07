import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { serverReason } from "./server-reason";

describe("serverReason", () => {
  test("русская причина сторожа выходит без префикса репозитория", () => {
    assert.equal(
      serverReason(
        new Error(
          "updateAppointment: Возвращённую оплату нельзя изменить; создайте новую заявку",
        ),
      ),
      "Возвращённую оплату нельзя изменить; создайте новую заявку",
    );
  });

  test("английская ошибка сети — не причина для диспетчера", () => {
    assert.equal(serverReason(new Error("Network request failed")), null);
    assert.equal(
      serverReason(new Error("deleteAppointment: JSON object requested")),
      null,
    );
  });

  test("не-ошибки не роняют", () => {
    assert.equal(serverReason(undefined), null);
    assert.equal(
      serverReason("Заявку с оплатой нельзя удалить"),
      "Заявку с оплатой нельзя удалить",
    );
  });
});
