import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { utcLabel, zoneClock, zoneOffsetMinutes } from "./device-timezone";

// ЭТИ ФУНКЦИИ РЕШАЮТ, КОГДА У БИЗНЕСА КОНЧАЕТСЯ ДЕНЬ.
//
// По часовому поясу считается «сегодня» в календаре, в кассе, в закрытии дня
// и в отчётах. Ошибка здесь стоит СУТОК: выручка попадёт не в тот день.
// Поэтому проверки — на конкретных датах и с переводом часов, а не на «в
// среднем работает».

// Зимнее и летнее время Европы: последнее воскресенье марта и октября.
const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("зона устройства и границы суток", () => {
  test("смещение считается верно и меняется вместе с переводом часов", () => {
    // Кипр: зимой UTC+2, летом UTC+3.
    assert.equal(zoneOffsetMinutes("Europe/Nicosia", WINTER), 120);
    assert.equal(zoneOffsetMinutes("Europe/Nicosia", SUMMER), 180);
    // Лондон: зимой UTC+0, летом UTC+1.
    assert.equal(zoneOffsetMinutes("Europe/London", WINTER), 0);
    assert.equal(zoneOffsetMinutes("Europe/London", SUMMER), 60);
  });

  test("зона без перевода часов не двигается", () => {
    assert.equal(zoneOffsetMinutes("Asia/Dubai", WINTER), 240);
    assert.equal(zoneOffsetMinutes("Asia/Dubai", SUMMER), 240);
  });

  test("получасовые зоны не округляются в ноль", () => {
    assert.equal(zoneOffsetMinutes("Asia/Kolkata", WINTER), 330);
  });

  test("подпись смещения читается человеком", () => {
    assert.equal(utcLabel("Europe/Nicosia", SUMMER), "UTC+3");
    assert.equal(utcLabel("America/New_York", WINTER), "UTC−5");
    assert.equal(utcLabel("Asia/Kolkata", WINTER), "UTC+5:30");
    assert.equal(utcLabel("Etc/GMT", WINTER), "UTC");
  });

  test("часы в зоне печатаются, а не выдумываются", () => {
    // 12:00 UTC зимой → 14:00 на Кипре.
    assert.equal(zoneClock("Europe/Nicosia", WINTER), "14:00");
    assert.equal(zoneClock("Europe/London", WINTER), "12:00");
  });

  test("несуществующая зона не роняет экран", () => {
    assert.equal(zoneOffsetMinutes("Nowhere/Nothing", WINTER), 0);
    assert.equal(zoneClock("Nowhere/Nothing", WINTER), "--:--");
  });
});
