import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calendarScreenSource } from "@/features/calendar/home/source-for-tests";

// БЕЗ ОПЛАТЫ КАЛЕНДАРЯ ЗАПИСЬ КЛИЕНТА В НЁМ — ТОЛЬКО ДЛЯ ПРОСМОТРА.
// Сервер (`appointments_free_readonly`) отклоняет любую правку записи с
// kind='work' в неоплаченном календаре, а календарь давал её тянуть,
// растягивать, красить, отменять и удалять — блок переезжал и откатывался с
// ошибкой сервера вместо плашки «Нужно оплатить календарь», которую
// показывает страница записи. Тариф — у календаря ЗАПИСИ: другой оплаченный
// календарь аккаунта её не открывает.

// The calendar screen is the route file plus `features/calendar/home/`.
const screen = () => calendarScreenSource();

describe("календарь без тарифа", () => {
  test("запись клиента не берётся пальцем и не растягивается", () => {
    const src = screen();
    const can = src.slice(src.indexOf("const canMoveAppointment = useCallback("));
    assert.match(
      can.slice(0, can.indexOf("[workInPlanFor,")),
      /if \(!workInPlanFor\(appointment\.team_id\) && !isCalendarEvent\(appointment\)\) return false;/,
    );
  });

  test("перенос — плашка тарифа, а не «Недостаточно прав»", () => {
    const src = screen();
    const move = src.slice(src.indexOf("const reschedule = ("));
    // И откуда, и куда: оба календаря должны быть оплачены.
    const lock = move.indexOf(
      "if (!isCalendarEvent(apt) && (!workInPlanFor(apt.team_id) || !workInPlanFor(teamId))) {\n      nudgeTariff();",
    );
    assert.ok(lock >= 0 && lock < move.indexOf("if (!canMoveAppointment(apt))"));
  });

  test("меню: всё, что меняет запись, зовёт плашку; открыть, позвонить, SMS — работают", () => {
    const src = screen();
    assert.match(src, /!event && !workInPlanFor\(apt\.team_id\)\s*\? items\.map\(\(item\) => \(item\.view \? item : \{ \.\.\.item, run: nudgeTariff \}\)\)/);
    assert.match(src, /items: shown,/);
    for (const label of ["Позвонить", "Маршрут", "Напомнить…"]) {
      const at = src.indexOf(`label: "${label}"`);
      assert.ok(at >= 0, label);
      assert.match(src.slice(at, at + 300), /view: true/, label);
    }
  });
});
