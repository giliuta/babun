import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { deriveWindow } from "./window";

// Окно рельса раздвигается под записи: запись, выпавшая из окна, не должна
// молча пропадать с сетки, оставаясь в «Списке».

function apt(timeStart: string, timeEnd: string): Appointment {
  return { id: "a1", time_start: timeStart, time_end: timeEnd } as Appointment;
}

const FALLBACK = { start: 8, end: 20 };
const EXPLICIT = { start: 8, end: 20 };

describe("окно рельса — записи на кромке", () => {
  test("событие нулевой длительности на конце окна — окно на час дальше", () => {
    const w = deriveWindow([], FALLBACK, [apt("20:00", "20:00")], EXPLICIT);
    assert.equal(w.endHour, 21);
  });

  test("запись «23:00–00:00» помещается целиком до конца суток", () => {
    const w = deriveWindow([], FALLBACK, [apt("23:00", "00:00")], EXPLICIT);
    assert.equal(w.endHour, 24);
  });

  test("обычная запись внутри окна его не трогает", () => {
    const w = deriveWindow([], FALLBACK, [apt("10:00", "11:00")], EXPLICIT);
    assert.deepEqual(w, { startHour: 8, endHour: 20 });
  });
});
