import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// БЕЗ ТАРИФА ЗАПИСЬ КЛИЕНТА В КАЛЕНДАРЕ — ТОЛЬКО ДЛЯ ПРОСМОТРА (аудит 03.10).
// Сервер (`appointments_free_readonly`) отклоняет любую правку записи с
// kind='work', а календарь давал её тянуть, растягивать, красить, отменять и
// удалять — блок переезжал и откатывался с ошибкой сервера вместо плашки
// «Нужно изменить тариф», которую показывает страница записи.

const here = dirname(fileURLToPath(import.meta.url));
const screen = () =>
  readFileSync(resolve(here, "../../../app/(dashboard)/(home)/index.tsx"), "utf8");

describe("календарь без тарифа", () => {
  test("запись клиента не берётся пальцем и не растягивается", () => {
    const src = screen();
    const can = src.slice(src.indexOf("const canMoveAppointment = useCallback("));
    assert.match(
      can.slice(0, can.indexOf("[workInPlan,")),
      /if \(!workInPlan && !isCalendarEvent\(appointment\)\) return false;/,
    );
  });

  test("перенос — плашка тарифа, а не «Недостаточно прав»", () => {
    const src = screen();
    const move = src.slice(src.indexOf("const reschedule = ("));
    const lock = move.indexOf("if (!workInPlan && !isCalendarEvent(apt)) {\n      nudgeTariff();");
    assert.ok(lock >= 0 && lock < move.indexOf("if (!canMoveAppointment(apt))"));
  });

  test("меню: всё, что меняет запись, зовёт плашку; открыть, позвонить, SMS — работают", () => {
    const src = screen();
    assert.match(src, /item\.view \? item : \{ \.\.\.item, run: nudgeTariff \}/);
    assert.match(src, /items: shown,/);
    for (const label of ["Позвонить", "Маршрут", "Напомнить…"]) {
      const at = src.indexOf(`label: "${label}"`);
      assert.ok(at >= 0, label);
      assert.match(src.slice(at, at + 300), /view: true/, label);
    }
  });
});
