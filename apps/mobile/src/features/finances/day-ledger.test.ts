import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { dayDebtRecords, isPastRecord } from "./day-ledger";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a",
    date: "2026-09-08",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    total_amount: 100,
    prepaid_amount: 0,
    payments: [],
    ...over,
  }) as unknown as Appointment;

describe("долг дня", () => {
  test("время прошло и не оплачено — долг; будущее и текущее — план", () => {
    const today = "2026-09-08";
    assert.equal(isPastRecord(appt({}), today, "12:00"), true);
    assert.equal(isPastRecord(appt({}), today, "10:30"), false);
    assert.equal(isPastRecord(appt({ date: "2026-09-09" }), today, "23:00"), false);
    assert.equal(isPastRecord(appt({ date: "2026-09-07" }), today, "00:00"), true);
    assert.equal(isPastRecord(appt({ status: "completed", date: "2026-09-09" }), today, "00:00"), true);
  });

  test("список долга дня: без отменённых и оплаченных", () => {
    const rows = [
      appt({ id: "unpaid" }),
      appt({
        id: "paid",
        payments: [{ id: "p1", method: "cash", paid_at: "2026-09-08T11:00:00Z", amount: 100 }],
      }),
      appt({ id: "cancelled", status: "cancelled" }),
      appt({ id: "later", time_start: "15:00", time_end: "16:00" }),
    ];
    const debt = dayDebtRecords(rows, "2026-09-08", "12:00");
    assert.deepEqual(debt.map((a) => a.id), ["unpaid"]);
    assert.deepEqual(dayDebtRecords(rows, "2026-09-08", "17:00").map((a) => a.id), ["unpaid", "later"]);
  });
});

