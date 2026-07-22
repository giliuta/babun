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
    const calendar = source("app/(dashboard)/index.tsx");
    assert.match(recurring, /reminderId:\s*item\.id/);
    assert.match(
      calendar,
      /params\.reminderId\s*\?\s*\{\s*reminderId:\s*params\.reminderId\s*\}/,
    );
  });

  test("marks the reminder only after appointment creation and keeps create errors separate", () => {
    const booking = source("app/book/index.tsx");
    const createdAt = booking.indexOf("await createMut.mutateAsync");
    const bookedAt = booking.indexOf("await updateReminderStatus.mutateAsync");
    assert.ok(createdAt >= 0, "booking must create the appointment");
    assert.ok(bookedAt > createdAt, "reminder may be booked only after create");
    assert.match(booking, /reminderUpdateFailed\s*=\s*true/);
    assert.match(booking, /напоминание осталось в списке/);
  });
});
