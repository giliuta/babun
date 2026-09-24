import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { lastVisitByObject } from "./object-last-visit";

type Row = Pick<Appointment, "status" | "date" | "location_id">;
const row = (
  location_id: string | null,
  date: string,
  status: Appointment["status"] = "completed",
): Row => ({ location_id, date, status });

describe("«был …» у объекта — последний визит по нему", () => {
  test("берёт самую позднюю дату, а не порядок массива", () => {
    const map = lastVisitByObject([
      row("villa", "2026-08-12"),
      row("villa", "2026-05-30"),
      row("flat", "2026-03-01"),
    ]);
    assert.equal(map.get("villa"), "2026-08-12");
    assert.equal(map.get("flat"), "2026-03-01");
  });

  test("визит — только выполненная запись, как в сводке", () => {
    const map = lastVisitByObject([
      row("villa", "2026-05-30"),
      // Отменённая, незакрытая прошлая и будущая — не приезд.
      row("villa", "2026-08-01", "cancelled"),
      row("villa", "2026-08-10", "scheduled"),
      row("villa", "2026-12-01", "in_progress"),
    ]);
    assert.equal(map.get("villa"), "2026-05-30");
  });

  test("записи без объекта или без даты не дают строки", () => {
    const map = lastVisitByObject([row(null, "2026-08-12"), row("villa", "")]);
    assert.equal(map.size, 0);
  });
});
