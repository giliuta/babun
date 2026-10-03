import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLIENT_TIME_OPTIONS,
  DEFAULT_NOTIFICATION_PREFS,
  RECORD_REMINDER_OPTIONS,
  clientTimeLabel,
  clockParts,
  normalizeNotificationPrefs,
  recordsLabel,
} from "./notification-prefs";

// Настройки уведомлений телефона (владелец 03.10): битое сохранённое —
// умолчание, подписи — словами шторки колокольчика.

describe("настройки уведомлений", () => {
  test("умолчания: о записях не напоминать, о клиентах в 09:00, бюджет — да", () => {
    assert.deepEqual(normalizeNotificationPrefs(undefined), DEFAULT_NOTIFICATION_PREFS);
    assert.deepEqual(normalizeNotificationPrefs({ records: { kind: "before", minutes: -5 }, clientTime: "25:00", budget: "y" }), DEFAULT_NOTIFICATION_PREFS);
  });

  test("сохранённое читается как есть, «не напоминать о клиентах» — null", () => {
    const p = normalizeNotificationPrefs({
      records: { kind: "dayAt", daysBefore: 1, time: "20:00" },
      clientTime: null,
      budget: false,
    });
    assert.deepEqual(p, { records: { kind: "dayAt", daysBefore: 1, time: "20:00" }, clientTime: null, budget: false });
  });

  test("подписи", () => {
    assert.equal(recordsLabel(null), "Не напоминать");
    assert.equal(recordsLabel({ kind: "before", minutes: 60 }), "За 1 час");
    assert.equal(recordsLabel({ kind: "dayAt", daysBefore: 1, time: "20:00" }), "Накануне в 20:00");
    assert.equal(clientTimeLabel("09:00"), "В 09:00");
    assert.equal(clientTimeLabel(null), "Не напоминать");
  });

  test("варианты начинаются с «Не напоминать»", () => {
    assert.equal(RECORD_REMINDER_OPTIONS[0], null);
    assert.equal(CLIENT_TIME_OPTIONS[0], null);
    assert.ok(RECORD_REMINDER_OPTIONS.length > 3);
  });

  test("время по частям, битое — 09:00", () => {
    assert.deepEqual(clockParts("18:30"), { hour: 18, minute: 30 });
    assert.deepEqual(clockParts("x"), { hour: 9, minute: 0 });
  });
});
