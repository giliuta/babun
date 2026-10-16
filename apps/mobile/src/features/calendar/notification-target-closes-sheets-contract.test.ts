import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calendarScreenSource } from "@/features/calendar/home/source-for-tests";

// ЛИСТЫ КАЛЕНДАРЯ УХОДЯТ ПЕРЕД ЗАПИСЬЮ ИЗ УВЕДОМЛЕНИЯ. Тап по
// уведомлению при открытых «Финансах дня» открывал страницу записи ПОД
// листом: человек видел прежний лист и думал, что тап не сработал.

// The calendar screen is the route file plus `features/calendar/home/`.
const home = calendarScreenSource();

describe("запись из уведомления", () => {
  test("перед страницей записи закрыты все листы календаря", () => {
    const start = home.indexOf("ЛИСТЫ КАЛЕНДАРЯ УХОДЯТ ПЕРЕД ЗАПИСЬЮ");
    assert.ok(start > 0, "блок на месте");
    const end = home.indexOf("router.push(\n            `/book?appointmentId=${target.id}", start);
    assert.ok(end > start, "переход на страницу записи — после блока");
    const block = home.slice(start, end);
    for (const close of [
      "setFinModalYmd(null)",
      "setSlotDraft(null)",
      "setSheetMenu(null)",
      "setSmsOpen(false)",
      "setReminderFor(null)",
      "setRecolor(null)",
      "setCityPickerYmd(null)",
      "setMiniCalOpen(false)",
    ]) {
      assert.ok(block.includes(close), `${close} — до перехода`);
    }
  });
});
