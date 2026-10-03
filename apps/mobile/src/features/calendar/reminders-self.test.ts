import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MemoryKVStorage, setStorage } from "@babun/shared/storage";
import { createBlankAppointment } from "@babun/shared/local/appointments";
import { getSelfReminder, setSelfReminder } from "./reminders";

describe("напоминание себе, которое не зазвонит, не хранится (повторный аудит 03.10)", () => {
  test("прошедшее время — «past», и шторка не покажет его отмеченным", async () => {
    setStorage(new MemoryKVStorage());
    const apt = createBlankAppointment({
      id: "11111111-1111-4111-8111-111111111111",
      date: "2020-01-01",
      time_start: "10:00",
      time_end: "11:00",
    });
    const result = await setSelfReminder(apt, { kind: "before", minutes: 30 } as never, "Asia/Nicosia");
    assert.equal(result, "past");
    assert.equal(getSelfReminder(apt.id), null);
  });
});
