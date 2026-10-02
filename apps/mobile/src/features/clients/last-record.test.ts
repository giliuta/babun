import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment, type Appointment } from "@babun/shared/local/appointments";

import { lastClientRecord, recordServiceNames } from "./last-record";

const appt = (id: string, date: string, time: string, extra: Partial<Appointment> = {}): Appointment =>
  ({ ...createBlankAppointment(), id, date, time_start: time, kind: "work", status: "scheduled", ...extra }) as Appointment;

describe("последняя запись клиента — лицо блока «История» (03.10)", () => {
  test("самая поздняя по дате и времени, будущая тоже", () => {
    const list = [appt("a", "2026-09-01", "10:00"), appt("b", "2026-10-03", "13:30"), appt("c", "2026-10-03", "09:00")];
    assert.equal(lastClientRecord(list)?.id, "b");
  });

  test("отменённая лицом не становится, пока есть живые", () => {
    const list = [appt("a", "2026-09-01", "10:00"), appt("b", "2026-10-03", "13:30", { status: "cancelled" })];
    assert.equal(lastClientRecord(list)?.id, "a");
  });

  test("живых нет — последняя отменённая; записей нет — null; события не в счёт", () => {
    assert.equal(lastClientRecord([appt("x", "2026-09-01", "10:00", { status: "cancelled" })])?.id, "x");
    assert.equal(lastClientRecord([]), null);
    assert.equal(lastClientRecord([appt("e", "2026-12-01", "10:00", { kind: "event" } as Partial<Appointment>)]), null);
  });

  test("услуги — новым составом, без него — прежним списком", () => {
    const names = new Map([["s1", "Чистка"], ["s2", "Заправка"]]);
    const by = (id: string) => names.get(id);
    assert.deepEqual(
      recordServiceNames({ services: [{ serviceId: "s2" } as never], service_ids: ["s1"] }, by),
      ["Заправка"],
    );
    assert.deepEqual(recordServiceNames({ services: [], service_ids: ["s1", "zz"] }, by), ["Чистка"]);
  });
});
