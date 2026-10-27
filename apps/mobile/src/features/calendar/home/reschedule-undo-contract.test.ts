import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// «ОТМЕНИТЬ» ПЕРЕНОСА — ЗЕРКАЛО ПРЯМОГО ХОДА: вид возвращается на прежний
// день, напоминания события — к прежнему времени.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "reschedule.ts"), "utf8");
const undo = src.slice(src.indexOf('label: "Отменить"'));

test("откат переноса на другой день возвращает вид на прежний день", () => {
  assert.match(undo, /if \(dateMoves\) setDay\(startOfDay\(parseYMD\(apt\.date\)\)\);/);
});

test("откат переставляет напоминания события обратно", () => {
  assert.match(undo, /syncEventAppointmentReminders\(apt, appointmentTimeZone\(apt\), visibilityTenantId\)/);
});
