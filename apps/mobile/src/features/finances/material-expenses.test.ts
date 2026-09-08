import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { isMaterialExpenseRow, materialExpenseRows } from "./material-expenses";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-06",
    time_start: "11:30",
    time_end: "13:00",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", quantity: 2 }],
    ...over,
  }) as unknown as Appointment;

const services = [
  { id: "s1", name: "A/C Cleaning", cost_per_unit: 4, material_costs: [] },
];

describe("materialExpenseRows", () => {
  test("завершённая запись с материалами — строка расхода с временем записи", () => {
    const rows = materialExpenseRows([appt({})], services, { from: "2026-09-01", to: "2026-09-30", teamId: "t1" });
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.type, "expense");
    assert.equal(row.amount, 8);
    assert.equal(row.occurred_on, "2026-09-06");
    assert.equal(row.occurred_time, "11:30");
    assert.equal(row.appointment_id, "a1");
    assert.equal(row.source, "auto");
    assert.ok(row.notes?.startsWith("Материалы"));
    assert.ok(isMaterialExpenseRow(row));
  });

  test("вне периода, чужая команда, отменённая или без материалов — строки нет", () => {
    const win = { from: "2026-09-01", to: "2026-09-30", teamId: "t1" };
    assert.equal(materialExpenseRows([appt({ date: "2026-08-30" })], services, win).length, 0);
    assert.equal(materialExpenseRows([appt({ team_id: "t2" })], services, win).length, 0);
    assert.equal(materialExpenseRows([appt({ status: "cancelled" })], services, win).length, 0);
    assert.equal(materialExpenseRows([appt({ service_ids: ["nope"], services: [] })], services, win).length, 0);
    assert.equal(materialExpenseRows([appt({})], services, { ...win, teamId: null }).length, 1);
  });
});
