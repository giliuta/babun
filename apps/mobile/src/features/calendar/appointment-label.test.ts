import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveOffDayLabel,
  type AppointmentLabelCity,
} from "./appointment-label";

const CITIES: AppointmentLabelCity[] = [
  { name: "Лимассол", color: "#2F6BFF" },
  { name: "Пафос", color: "#F0A020" },
  { name: "Ларнака", color: null },
];

describe("resolveOffDayLabel", () => {
  test("метка записи другая — сигнал с цветом справочника", () => {
    assert.deepEqual(
      resolveOffDayLabel({
        city: "Пафос",
        dayLabelName: "Лимассол",
        cities: CITIES,
      }),
      { name: "Пафос", color: "#F0A020" },
    );
  });

  test("метки совпали — сигнала нет", () => {
    assert.equal(
      resolveOffDayLabel({
        city: "Лимассол",
        dayLabelName: "Лимассол",
        cities: CITIES,
      }),
      null,
    );
  });

  test("у дня метки нет — своя метка записи не «другая»", () => {
    // Иначе засветилась бы вся история: у прошлых дней метка по расписанию
    // не считается вовсе.
    assert.equal(
      resolveOffDayLabel({
        city: "Пафос",
        dayLabelName: null,
        cities: CITIES,
      }),
      null,
    );
  });

  test("у записи метки нет — сигнала нет", () => {
    for (const city of [null, undefined, "", "   "]) {
      assert.equal(
        resolveOffDayLabel({ city, dayLabelName: "Лимассол", cities: CITIES }),
        null,
      );
    }
  });

  test("пробелы вокруг имён не создают ложного расхождения", () => {
    assert.equal(
      resolveOffDayLabel({
        city: " Лимассол ",
        dayLabelName: "Лимассол",
        cities: CITIES,
      }),
      null,
    );
  });

  test("метки нет в справочнике — не красим наугад", () => {
    assert.equal(
      resolveOffDayLabel({
        city: "Никосия",
        dayLabelName: "Лимассол",
        cities: CITIES,
      }),
      null,
    );
    assert.deepEqual(
      resolveOffDayLabel({
        city: "Никосия",
        dayLabelName: "Лимассол",
        cities: CITIES,
        fallbackColor: "#8E8E93",
      }),
      { name: "Никосия", color: "#8E8E93" },
    );
  });

  test("метка без цвета в справочнике падает на запасной", () => {
    assert.equal(
      resolveOffDayLabel({
        city: "Ларнака",
        dayLabelName: "Лимассол",
        cities: CITIES,
      }),
      null,
    );
    assert.deepEqual(
      resolveOffDayLabel({
        city: "Ларнака",
        dayLabelName: "Лимассол",
        cities: CITIES,
        fallbackColor: "#8E8E93",
      }),
      { name: "Ларнака", color: "#8E8E93" },
    );
  });
});
