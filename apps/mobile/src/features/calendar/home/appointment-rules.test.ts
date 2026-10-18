import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type Appointment,
  type Payment,
} from "@babun/shared/local/appointments";
import { holdsMoney, isPersonalEvent, settledVisit } from "./appointment-rules";

const work = (extra: Partial<Appointment> = {}) =>
  createBlankAppointment({ kind: "work", team_id: "t1", ...extra });
const event = (extra: Partial<Appointment> = {}) =>
  createBlankAppointment({ kind: "event", ...extra });
const onePayment: Payment[] = [
  { id: "p1", method: "cash", amount: 20, paid_at: "2026-10-13T10:00:00Z" },
];

describe("isPersonalEvent", () => {
  test("an event without a team is personal; with a team or a work record it is not", () => {
    assert.equal(isPersonalEvent(event({ team_id: null })), true);
    assert.equal(isPersonalEvent(event({ team_id: "t1" })), false);
    assert.equal(isPersonalEvent(work({ team_id: null })), false);
  });
});

describe("settledVisit", () => {
  test("paid money, a payment row or a paid completion keeps the visit in its day", () => {
    assert.equal(settledVisit(work()), false);
    assert.equal(settledVisit(work({ paid_amount: 20 })), true);
    assert.equal(settledVisit(work({ payments: onePayment })), true);
    assert.equal(settledVisit(work({ status: "completed", payment_status: "paid" })), true);
    assert.equal(settledVisit(work({ status: "scheduled", payment_status: "paid" })), false);
  });

  test("events and refunded visits are never settled", () => {
    assert.equal(settledVisit(event({ paid_amount: 20 })), false);
    assert.equal(settledVisit(work({ paid_amount: 20, payment_status: "refunded" })), false);
  });
});

describe("holdsMoney", () => {
  test("any received money counts", () => {
    assert.equal(holdsMoney(work()), false);
    assert.equal(holdsMoney(work({ prepaid_amount: 10 })), true);
    assert.equal(holdsMoney(work({ paid_amount: 10 })), true);
    assert.equal(holdsMoney(work({ payment_status: "partial" })), true);
    assert.equal(holdsMoney(work({ payment_status: "paid" })), true);
    assert.equal(holdsMoney(work({ payments: onePayment })), true);
  });

  test("events and already refunded records hold nothing", () => {
    assert.equal(holdsMoney(event({ prepaid_amount: 10 })), false);
    assert.equal(holdsMoney(work({ prepaid_amount: 10, payment_status: "refunded" })), false);
  });
});
