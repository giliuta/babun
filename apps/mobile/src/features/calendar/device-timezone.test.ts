import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  sameDayBoundary,
  utcLabel,
  zoneClock,
  zoneOffsetMinutes,
} from "./device-timezone";

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

  test("разные имена ОДНОЙ границы суток считаются равными", () => {
    // Симулятор отдаёт Asia/Nicosia, в списке лежит Europe/Nicosia.
    // Строки разные — сутки одни, переписывать зону не за чем.
    assert.equal(sameDayBoundary("Asia/Nicosia", "Europe/Nicosia", WINTER), true);
    assert.equal(sameDayBoundary("Asia/Nicosia", "Europe/Nicosia", SUMMER), true);
  });

  test("ГЛАВНОЕ: живая зона и фиксированная НЕ равны, даже когда сегодня совпали", () => {
    // Зимой Кипр = UTC+2 = Etc/GMT-2. Сегодня одно и то же.
    assert.equal(zoneOffsetMinutes("Europe/Nicosia", WINTER), 120);
    assert.equal(zoneOffsetMinutes("Etc/GMT-2", WINTER), 120);
    // Но через полгода Кипр уходит на +3, а фиксированная зона — нет.
    // Без этой проверки продукт молча заменил бы живую зону фиксированной,
    // и после перевода часов всё после 23:00 уехало бы в другие сутки.
    assert.equal(
      sameDayBoundary("Europe/Nicosia", "Etc/GMT-2", WINTER),
      false,
      "живая зона не должна считаться равной фиксированной",
    );
  });

  test("разные зоны с разной границей суток не равны", () => {
    assert.equal(sameDayBoundary("Europe/Warsaw", "Europe/Nicosia", WINTER), false);
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
