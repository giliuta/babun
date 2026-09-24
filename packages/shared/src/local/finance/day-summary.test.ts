import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "../appointments";
import { computeDayFinance } from "./day-summary";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a",
    date: "2026-09-10",
    status: "scheduled",
    total_amount: 255,
    paid_amount: 0,
    prepaid_amount: 0,
    payment_status: "unpaid",
    payments: [],
    payment: null,
    expenses: [],
    services: [],
    service_ids: [],
    ...over,
  }) as unknown as Appointment;

// «ДОХОД» ДНЯ — ПРИШЕДШИЕ ДЕНЬГИ (владелец 2026-09-24).
describe("заработано за день", () => {
  test("неоплаченная запись — не доход, но она в плане", () => {
    const totals = computeDayFinance([appt({})], [], []);
    assert.equal(totals.earned, 0);
    assert.equal(totals.planned, 255);
  });

  test("предоплата по запланированной записи — уже доход", () => {
    const totals = computeDayFinance([appt({ prepaid_amount: 255 })], [], []);
    assert.equal(totals.earned, 255);
  });

  test("полный возврат дохода не даёт", () => {
    const totals = computeDayFinance(
      [appt({ status: "completed", prepaid_amount: 195, payment_status: "refunded" })],
      [],
      [],
    );
    assert.equal(totals.earned, 0);
  });
});
