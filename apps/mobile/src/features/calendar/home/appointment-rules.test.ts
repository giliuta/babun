import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type Appointment,
  type Payment,
} from "@babun/shared/local/appointments";
import {
  SERVICES_HOLD_TEAM,
  SETTLED_STAYS,
  holdsMoney,
  keptForMoneyHistory,
  isPersonalEvent,
  placementRefusal,
  placementTeam,
  settledVisit,
} from "./appointment-rules";

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

describe("placementTeam", () => {
  test("the chip decides, except for crew and personal events", () => {
    assert.equal(placementTeam(work(), "t2", false), "t2");
    assert.equal(placementTeam(work(), null, false), "t1");
    assert.equal(placementTeam(work(), "t2", true), "t1");
    assert.equal(placementTeam(event({ team_id: null }), "t2", false), null);
  });
});

describe("placementRefusal", () => {
  const services = [{ id: "s1", team_id: "t1" }];
  const paid = work({ date: "2026-10-30", paid_amount: 20 });

  test("a paid visit moves only inside its own day and team", () => {
    assert.equal(placementRefusal(paid, "move", "2026-10-30", "t1", services), null);
    assert.equal(placementRefusal(paid, "move", "2026-10-31", "t1", services), SETTLED_STAYS);
    assert.equal(placementRefusal(paid, "move", "2026-10-30", "t2", services), SETTLED_STAYS);
  });

  test("a copy of a paid visit goes anywhere", () => {
    assert.equal(placementRefusal(paid, "copy", "2026-10-31", "t2", services), null);
  });

  test("services of its own price list keep the record in its team", () => {
    const withService = work({ service_ids: ["s1"] });
    assert.equal(placementRefusal(withService, "move", "2026-10-31", "t2", services), SERVICES_HOLD_TEAM);
    assert.equal(placementRefusal(withService, "copy", "2026-10-31", "t2", services), SERVICES_HOLD_TEAM);
    assert.equal(placementRefusal(withService, "move", "2026-10-31", "t1", services), null);
    assert.equal(placementRefusal(work(), "move", "2026-10-31", "t2", services), null);
  });
});

describe("keptForMoneyHistory — то же правило, что сторож удаления на сервере", () => {
  test("запись без денег, способа оплаты и инвойса удаляется", () => {
    assert.equal(keptForMoneyHistory(work(), false), false);
    assert.equal(keptForMoneyHistory(event(), false), false);
  });
  test("деньги, способ оплаты, возврат или инвойс держат запись", () => {
    assert.equal(keptForMoneyHistory(work({ prepaid_amount: 10 }), false), true);
    assert.equal(keptForMoneyHistory(work({ payments: onePayment }), false), true);
    assert.equal(keptForMoneyHistory(work({ payment_method: "cash" }), false), true);
    assert.equal(keptForMoneyHistory(work({ payment_status: "refunded" }), false), true);
    assert.equal(keptForMoneyHistory(work(), true), true);
  });
});
