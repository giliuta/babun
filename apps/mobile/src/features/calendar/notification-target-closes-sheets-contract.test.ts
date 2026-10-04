import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// ЛИСТЫ КАЛЕНДАРЯ УХОДЯТ ПЕРЕД ЗАПИСЬЮ ИЗ УВЕДОМЛЕНИЯ (прогон 04.10). Тап по
// уведомлению при открытых «Финансах дня» открывал страницу записи ПОД
// листом: человек видел прежний лист и думал, что тап не сработал.

const home = readFileSync(
  path.join(__dirname, "../../../app/(dashboard)/(home)/index.tsx"),
  "utf8",
);

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
