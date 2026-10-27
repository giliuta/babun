import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pushSettingsColumns, pushSettingsFromRow, quietLabel } from "./push-settings-rules";

describe("пуш-настройки человека", () => {
  test("строки нет — всё выключено", () => {
    assert.deepEqual(pushSettingsFromRow(null), {
      digestMorning: false,
      digestEvening: false,
      quietStart: null,
      quietEnd: null,
    });
  });

  test("тихие часы через полночь; равные или битые границы — выключены", () => {
    assert.deepEqual(pushSettingsFromRow({ quiet_start: 1320, quiet_end: 420 }).quietStart, 1320);
    assert.equal(pushSettingsFromRow({ quiet_start: 600, quiet_end: 600 }).quietStart, null);
    assert.equal(pushSettingsFromRow({ quiet_start: 1320, quiet_end: 2000 }).quietEnd, null);
    assert.equal(quietLabel(1320, 420), "22:00 – 07:00");
  });

  test("пишутся только изменённые столбцы — сводки не зависят от миграции тихих часов", () => {
    assert.deepEqual(pushSettingsColumns({ digestMorning: true }), { digest_morning: true });
    assert.deepEqual(pushSettingsColumns({ quietStart: null, quietEnd: null }), { quiet_start: null, quiet_end: null });
  });
});
