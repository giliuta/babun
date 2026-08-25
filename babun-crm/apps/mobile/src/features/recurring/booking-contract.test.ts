import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, test } from "node:test";

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function source(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), "utf8");
}

describe("recurring reminder → booking contract", () => {
  test("forwards reminder identity through calendar into the full booking page", () => {
    const recurring = source("app/(dashboard)/cabinet/recurring.tsx");
    const calendar = source("app/(dashboard)/(home)/index.tsx");
    assert.match(recurring, /reminderId:\s*item\.id/);
    assert.match(
      calendar,
      /params\.reminderId\s*\?\s*\{\s*reminderId:\s*params\.reminderId\s*\}/,
    );
  });

  test("marks the reminder only after appointment creation and keeps create errors separate", () => {
    // Инвариант прежний, дом другой: хвост сохранения переехал из
    // app/book/index.tsx в общий useBookingSave, чтобы шторка «Записать»
    // с карточки клиента не завела второй путь создания.
    const save = source("src/features/appointments/useBookingSave.ts");
    const createdAt = save.indexOf("await createMut.mutateAsync");
    const bookedAt = save.indexOf("await updateReminderStatus.mutateAsync");
    assert.ok(createdAt >= 0, "booking must create the appointment");
    assert.ok(bookedAt > createdAt, "reminder may be booked only after create");
    assert.match(save, /reminderUpdateFailed\s*=\s*true/);
    assert.match(save, /напоминание осталось в списке/);
  });

  test("the booking page creates ONLY through the shared hook", () => {
    // Смысл выноса — один путь создания на всё приложение. Если кто-то
    // снова вызовет мутацию создания прямо на экране, побочные эффекты
    // (закрытие напоминания, push события) тихо разъедутся с хуком.
    const booking = source("app/book/index.tsx");
    assert.match(booking, /useBookingSave\(\)/);
    assert.ok(
      !booking.includes("useCreateAppointment"),
      "book screen must not create appointments directly — use useBookingSave",
    );
  });
});
