import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calendarSettingsRows } from "./settings-rows";

const PAID = { services: true };
const FREE = { services: false };

describe("строки настроек календаря", () => {
  test("владелец на платном видит все строки", () => {
    const rows = calendarSettingsRows("owner", PAID);
    assert.deepEqual(rows, {
      rename: true,
      renameEdit: true,
      addCalendar: true,
      timezone: true,
      timezoneEdit: true,
      hours: true,
      hoursEdit: true,
      schedule: true,
      scheduleEdit: true,
      buffer: true,
      booking: true,
      services: true,
      labels: true,
      remove: true,
      any: true,
    });
  });

  test("тариф гасит только «Услуги»", () => {
    const rows = calendarSettingsRows("owner", FREE);
    assert.equal(rows.services, false);
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

  test("сотрудник: строка графика — по его праву в «Настройках команды» (30.09)", () => {
    const read = calendarSettingsRows("master", PAID, { schedule: "read" });
    assert.equal(read.schedule, true);
    assert.equal(read.scheduleEdit, false, "«Только видит» — строка без правки");
    assert.equal(read.buffer, false);
    assert.equal(read.any, true);
    const write = calendarSettingsRows("master", PAID, { schedule: "write" });
    assert.equal(write.scheduleEdit, true);
    // «Видит и меняет» — меняет всё в строке, перерыв после записи тоже.
    assert.equal(write.buffer, true);
    for (const other of ["rename", "timezone", "hours", "booking", "labels", "remove"] as const) {
      assert.equal(write[other], false, `«${other}» сотруднику не открывается правом графика`);
    }
  });

  test("сотрудник: название, пояс и часы — по его праву; валюта и удаление — никогда", () => {
    const rows = calendarSettingsRows("master", PAID, { identity: "write", timezone: "read", hours: "hidden" });
    assert.equal(rows.rename, true);
    assert.equal(rows.renameEdit, true);
    assert.equal(rows.timezone, true);
    assert.equal(rows.timezoneEdit, false, "«Только видит» — строка без двери");
    assert.equal(rows.hours, false);
    assert.equal(rows.remove, false);
    assert.equal(rows.addCalendar, false);
  });

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
    assert.equal(rows.any, rows.timezone || rows.labels);
  });
});
