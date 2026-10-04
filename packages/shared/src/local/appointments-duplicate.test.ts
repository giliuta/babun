import { describe, expect, test } from "bun:test";
import { createBlankAppointment, duplicateAppointment } from "./appointments";

// КОПИЯ ЗАПИСИ — БЕЗ ЧУЖИХ ДЕНЕГ И БЕЗ ВТОРОЙ СЕРИИ (аудит 03.10).
describe("копия записи", () => {
  test("строки предоплаты оригинала не копируются", () => {
    const original = createBlankAppointment({
      prepaid_amount: 50,
      prepayments: [{ id: "p1", amount: 50 } as never],
    });
    const copy = duplicateAppointment(original);
    expect(copy.prepaid_amount).toBe(0);
    expect(copy.prepayments).toEqual([]);
  });

  test("копия повторяющегося события — разовая", () => {
    const series = createBlankAppointment({ kind: "event", event_repeat: { kind: "daily" } });
    expect(duplicateAppointment(series).event_repeat).toEqual({ kind: "none" });
  });

  test("разовое событие и запись без повтора — как были", () => {
    expect(duplicateAppointment(createBlankAppointment({})).event_repeat).toBeUndefined();
  });
});
