import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment, type Appointment } from "@babun/shared/local/appointments";

import { visitStatus } from "./visit-status";

const TODAY = "2026-10-03";
const appt = (extra: Partial<Appointment>): Appointment =>
  ({
    ...createBlankAppointment(),
    kind: "work",
    date: "2026-09-20",
    status: "completed",
    total_amount: 100,
    paid_amount: 100,
    payment_status: "paid",
    ...extra,
  }) as Appointment;

describe("состояние записи в истории — одним словом справа (03.10)", () => {
  test("оплачено, долг, ожидается, отменена", () => {
    assert.deepEqual(visitStatus(appt({}), TODAY, true), { kind: "paid", text: "Оплачено" });
    assert.equal(visitStatus(appt({ paid_amount: 70, payment_status: "partial" }), TODAY, true).kind, "debt");
    assert.match(visitStatus(appt({ paid_amount: 70, payment_status: "partial" }), TODAY, true).text, /^Долг /);
    assert.deepEqual(
      visitStatus(appt({ date: "2026-10-04", status: "scheduled", paid_amount: 0, payment_status: "unpaid" }), TODAY, true),
      { kind: "ahead", text: "Ожидается" },
    );
    assert.equal(visitStatus(appt({ status: "cancelled" }), TODAY, true).kind, "cancelled");
  });

  test("прошедшая незакрытая — долг по правилу сводки; без суммы — «Не закрыта»", () => {
    assert.equal(visitStatus(appt({ status: "scheduled", paid_amount: 0, payment_status: "unpaid" }), TODAY, true).kind, "debt");
    assert.equal(
      visitStatus(appt({ status: "scheduled", total_amount: 0, paid_amount: 0, payment_status: "unpaid" }), TODAY, true).kind,
      "unclosed",
    );
  });

  test("без права «Долг и деньги» — без сумм, словами о работе", () => {
    assert.deepEqual(visitStatus(appt({}), TODAY, false), { kind: "done", text: "Выполнена" });
    assert.deepEqual(visitStatus(appt({ paid_amount: 0, payment_status: "unpaid" }), TODAY, false), {
      kind: "done",
      text: "Выполнена",
    });
    assert.deepEqual(visitStatus(appt({ status: "scheduled", paid_amount: 0, payment_status: "unpaid" }), TODAY, false), {
      kind: "unclosed",
      text: "Не закрыта",
    });
  });
});
