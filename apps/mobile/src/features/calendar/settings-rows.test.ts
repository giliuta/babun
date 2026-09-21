import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calendarSettingsRows } from "./settings-rows";

const PAID = { services: true, masters: true };
const FREE = { services: false, masters: false };

describe("строки настроек календаря", () => {
  test("владелец на платном видит все строки", () => {
    const rows = calendarSettingsRows("owner", PAID);
    assert.deepEqual(rows, {
      rename: true,
      addCalendar: true,
      timezone: true,
      currency: true,
      masters: true,
      hours: true,
      schedule: true,
      booking: true,
      services: true,
      labels: true,
      viewPrefs: true,
      remove: true,
      any: true,
    });
  });

  test("тариф гасит только свои две строки", () => {
    const rows = calendarSettingsRows("owner", FREE);
    assert.equal(rows.services, false);
    assert.equal(rows.masters, false);
    assert.equal(rows.timezone, true);
    assert.equal(rows.any, true);
  });

  for (const role of ["master", "dispatcher"] as const) {
    test(`${role}: страница открыта, но строк в ней нет`, () => {
      const rows = calendarSettingsRows(role, PAID);
      assert.equal(rows.any, false);
      for (const [name, shown] of Object.entries(rows)) {
        assert.equal(shown, false, `${role} не должен видеть «${name}»`);
      }
    });
  }

  test("удаление календаря сотруднику не показывается", () => {
    // Строка «Удалить календарь» — единственная разрушающая на экране;
    // она обязана исчезать вместе с остальными, а не «просто не работать».
    assert.equal(calendarSettingsRows("master", PAID).remove, false);
    assert.equal(calendarSettingsRows("dispatcher", PAID).remove, false);
    assert.equal(calendarSettingsRows("owner", FREE).remove, true);
  });

  test("роль ещё не пришла — строк нет, но и отказа нет", () => {
    assert.equal(calendarSettingsRows(undefined, PAID).any, false);
    assert.equal(calendarSettingsRows(null, PAID).any, false);
  });

  test("«страница не пустая» считается по строкам, а не по праву", () => {
    // Владелец бесплатного контура, у которого обе тарифные строки погашены,
    // всё равно видит остальные: иначе «any» врал бы про свою же страницу.
    const rows = calendarSettingsRows("owner", FREE);
    assert.equal(rows.any, rows.timezone || rows.currency || rows.labels);
  });
});
