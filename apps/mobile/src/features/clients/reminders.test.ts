import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  clientReminderFireDate,
  parseClientNotificationTarget,
} from "./reminders";

describe("client reminders", () => {
  test("turns a date-only value into local 09:00 without UTC day drift", () => {
    const result = clientReminderFireDate(
      "2026-07-21",
      new Date(2026, 6, 20, 23, 59),
    );
    assert.ok(result);
    assert.equal(result.getFullYear(), 2026);
    assert.equal(result.getMonth(), 6);
    assert.equal(result.getDate(), 21);
    assert.equal(result.getHours(), 9);
    assert.equal(result.getMinutes(), 0);
  });

  test("время из «Уведомлений» (03.10): звонит в выбранный час", () => {
    const result = clientReminderFireDate("2026-07-21", new Date(2026, 6, 20, 23, 59), "18:30");
    assert.ok(result);
    assert.equal(result.getDate(), 21);
    assert.equal(result.getHours(), 18);
    assert.equal(result.getMinutes(), 30);
    // Сегодняшняя дата, а час уже прошёл — не ставится.
    assert.equal(clientReminderFireDate("2026-07-20", new Date(2026, 6, 20, 19, 0), "18:30"), null);
  });

  test("rejects invalid and already elapsed dates", () => {
    assert.equal(
      clientReminderFireDate("2026-02-30", new Date(2026, 0, 1)),
      null,
    );
    assert.equal(
      clientReminderFireDate("2026-07-20", new Date(2026, 6, 20, 9, 1)),
      null,
    );
  });

  test("accepts only a bounded client reminder target", () => {
    assert.deepEqual(
      parseClientNotificationTarget({
        type: "client-reminder",
        clientId: "client-1",
      }),
      { clientId: "client-1" },
    );
    assert.equal(
      parseClientNotificationTarget({ type: "calendar-appointment", clientId: "client-1" }),
      null,
    );
    assert.equal(
      parseClientNotificationTarget({
        type: "client-reminder",
        clientId: "x".repeat(129),
      }),
      null,
    );
  });
});

describe("удалённый клиент не получает напоминания", () => {
  test("удаление снимает и забывает обещание, а не только уведомление", () => {
    const trash = readFileSync(join(__dirname, "queries/archive-trash.ts"), "utf8");
    const own = readFileSync(join(__dirname, "reminders.ts"), "utf8");
    assert.doesNotMatch(trash, /cancelClientReminder/);
    assert.match(trash, /dropClientReminder/);
    assert.match(own, /export async function dropClientReminder[\s\S]{0,120}forgetWanted\(clientId\)/);
  });
});
