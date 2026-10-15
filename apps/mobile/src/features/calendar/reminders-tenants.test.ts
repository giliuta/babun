import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { babunNotificationRegistrySnapshot } from "@/lib/notifications";
import { reconcileEventAppointmentReminders } from "./reminders";

// СВЕРКА КАЛЕНДАРЯ НЕ СТИРАЕТ ПУШИ ДРУГОГО АККАУНТА (13.10). Список календаря
// держит записи только открытого аккаунта; замена всей группы `event:`
// снимала пуши событий своего аккаунта, пока человек смотрел чужой.

const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
const event = (id: string) =>
  createBlankAppointment({
    id,
    kind: "event",
    date: tomorrow,
    time_start: "10:00",
    time_end: "11:00",
    event_push_enabled: true,
    event_push_offsets: [30],
  });
const owners = () => babunNotificationRegistrySnapshot().map((item) => item.ownerKey);
const tz = () => "Asia/Nicosia";

describe("пуши событий по аккаунтам", () => {
  test("сверка аккаунта B оставляет пуш события аккаунта A", async () => {
    setStorage(new MemoryKVStorage());
    await reconcileEventAppointmentReminders([event("a-1")], tz, "tenant-a");
    assert.ok(owners().includes("event:tenant-a:a-1"), owners().join(","));
    await reconcileEventAppointmentReminders([event("b-1")], tz, "tenant-b");
    assert.ok(owners().includes("event:tenant-a:a-1"), "пуш аккаунта A стёрт сверкой B");
    assert.ok(owners().includes("event:tenant-b:b-1"));
    // Своя группа заменяется целиком: событие пропало из списка — пуш снят.
    await reconcileEventAppointmentReminders([], tz, "tenant-b");
    assert.ok(!owners().includes("event:tenant-b:b-1"));
    assert.ok(owners().includes("event:tenant-a:a-1"));
  });
});
