import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dayWords, isAppointmentLinkToken, linkTitle, parseAppointmentLink } from "./appointment-link";

describe("ссылка «Подтвердить / Отменить»", () => {
  test("токен — только латиница и цифры нужной длины", () => {
    assert.equal(isAppointmentLinkToken("Ab3dE5fG7hJ9"), true);
    assert.equal(isAppointmentLinkToken("short"), false);
    assert.equal(isAppointmentLinkToken("Ab3dE5fG7h/9"), false);
    assert.equal(isAppointmentLinkToken(undefined), false);
  });

  test("ответ базы разбирается, незнакомое состояние — «нет ссылки»", () => {
    const info = parseAppointmentLink({
      state: "pending",
      business_name: "Giliuta",
      client_first_name: "Ппк",
      date: "2026-09-25",
      time: "13:30",
      address: " ",
      services: ["Клининг", "", null, "A/C Cleaning"],
    });
    assert.deepEqual(
      [info.state, info.businessName, info.address, info.services],
      ["pending", "Giliuta", null, ["Клининг", "A/C Cleaning"]],
    );
    assert.equal(parseAppointmentLink({ state: "что-то" }).state, "missing");
    assert.equal(parseAppointmentLink(null).state, "missing");
  });

  test("день словами и заголовок по состоянию", () => {
    assert.equal(dayWords("2026-09-25"), "Пятница, 25 сентября");
    assert.equal(dayWords(null), null);
    assert.equal(linkTitle({ state: "pending", clientFirstName: "Анна" }), "Анна, вы записаны");
    assert.equal(linkTitle({ state: "pending", clientFirstName: "" }), "Вы записаны");
    assert.equal(linkTitle({ state: "cancelled", clientFirstName: "Анна" }), "Запись отменена");
  });
});
