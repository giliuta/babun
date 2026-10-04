import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ChangeLogRow } from "./change-log";
import {
  CLIENT_TIME_OPTIONS,
  DEFAULT_TEAM_PREFS,
  RECORD_REMINDER_OPTIONS,
  activityKind,
  activityNotification,
  clientTimeLabel,
  clockParts,
  prefsFromRow,
  recordsLabel,
  rowFromPrefs,
  shouldNotify,
} from "./notification-prefs";

// Уведомления на команду (владелец 03.10): строка базы ↔ настройки, какое
// событие журнала о чём, кому сообщать.

const row = (over: Partial<ChangeLogRow>): ChangeLogRow => ({
  id: 1,
  team_id: "team-1",
  actor_id: "partner",
  actor_name: "Иван",
  entity: "appointments",
  entity_id: "a1",
  action: "insert",
  label: "Анастасия",
  meta: { kind: "work", date: "2026-10-04", time: "14:00" },
  changes: null,
  created_at: "2026-10-03T12:00:00Z",
  ...over,
});

describe("настройки команды", () => {
  test("строки нет — умолчания столбцов базы", () => {
    assert.deepEqual(prefsFromRow(null), DEFAULT_TEAM_PREFS);
    assert.equal(DEFAULT_TEAM_PREFS.clientTime, "09:00");
    assert.equal(DEFAULT_TEAM_PREFS.records, null);
    assert.equal(DEFAULT_TEAM_PREFS.notifyPayment, false);
  });

  test("строка ↔ настройки без потерь, битое поле — умолчание", () => {
    const prefs = {
      ...DEFAULT_TEAM_PREFS,
      records: { kind: "before", minutes: 60 } as const,
      clientTime: null,
      notifyCancel: false,
    };
    assert.deepEqual(prefsFromRow({ tenant_id: "t", team_id: "x", ...rowFromPrefs(prefs) }), prefs);
    assert.equal(prefsFromRow({ client_reminder_time: "25:00" }).clientTime, "09:00");
    assert.equal(prefsFromRow({ record_reminder: { kind: "before", minutes: -1 } }).records, null);
  });

  test("подписи и варианты", () => {
    assert.equal(recordsLabel(null), "Не напоминать");
    assert.equal(recordsLabel({ kind: "dayAt", daysBefore: 1, time: "20:00" }), "Накануне в 20:00");
    assert.equal(clientTimeLabel("09:00"), "В 09:00");
    assert.equal(clientTimeLabel(null), "Не напоминать");
    assert.equal(RECORD_REMINDER_OPTIONS[0], null);
    assert.equal(CLIENT_TIME_OPTIONS[0], null);
    assert.deepEqual(clockParts("18:30"), { hour: 18, minute: 30 });
    assert.deepEqual(clockParts("x"), { hour: 9, minute: 0 });
  });
});

describe("что происходит в команде", () => {
  test("новая запись, перенос, отмена, оплата", () => {
    assert.equal(activityKind(row({})), "new");
    assert.equal(activityKind(row({ action: "update", changes: { time_start: ["09:30", "10:00"] } })), "change");
    assert.equal(activityKind(row({ action: "update", changes: { status: ["scheduled", "cancelled"], cancel_reason: [null, "x"] } })), "cancel");
    assert.equal(activityKind(row({ action: "delete" })), "cancel");
    assert.equal(activityKind(row({ action: "update", changes: { prepayments: "*", paid_amount: [0, 50] } })), "payment");
    assert.equal(activityKind(row({ entity: "finance_transactions", meta: { type: "income", amount: 50 } })), "payment");
  });

  test("события, расходы и справочники — не новости", () => {
    assert.equal(activityKind(row({ meta: { kind: "event" } })), null);
    assert.equal(activityKind(row({ entity: "finance_transactions", meta: { type: "expense" } })), null);
    assert.equal(activityKind(row({ entity: "clients" })), null);
  });

  test("свои действия не присылаются, выключенное — тоже", () => {
    assert.equal(shouldNotify(row({}), DEFAULT_TEAM_PREFS, "me"), true);
    assert.equal(shouldNotify(row({ actor_id: "me" }), DEFAULT_TEAM_PREFS, "me"), false);
    assert.equal(shouldNotify(row({}), { ...DEFAULT_TEAM_PREFS, notifyNew: false }, "me"), false);
    // Оплаты по умолчанию молчат.
    assert.equal(shouldNotify(row({ entity: "finance_transactions", meta: { type: "income" } }), DEFAULT_TEAM_PREFS, "me"), false);
    assert.equal(shouldNotify(row({}), DEFAULT_TEAM_PREFS, null), false);
  });

  test("текст уведомления: что и где, с чем и кто", () => {
    assert.deepEqual(activityNotification(row({}), "Y&D", "Иван"), {
      title: "Запись создана · Y&D",
      body: "Анастасия · 4 окт, 14:00 — Иван",
    });
  });
});
