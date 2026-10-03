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

describe("число записи в истории — правильным цветом, без слов (03.10)", () => {
  test("оплачено — сумма зелёным, долг — остаток янтарём, впереди — сумма кобальтом", () => {
    assert.deepEqual(
      { ...visitStatus(appt({}), TODAY, true), label: undefined },
      { kind: "paid", text: "€100", label: undefined },
    );
    const debt = visitStatus(appt({ paid_amount: 70, payment_status: "partial" }), TODAY, true);
    assert.equal(debt.kind, "debt");
    assert.equal(debt.text, "€30");
    const ahead = visitStatus(appt({ date: "2026-10-04", status: "scheduled", paid_amount: 0, payment_status: "unpaid" }), TODAY, true);
    assert.equal(ahead.kind, "ahead");
    assert.equal(ahead.text, "€100");
    assert.equal(visitStatus(appt({ status: "cancelled" }), TODAY, true).kind, "cancelled");
  });

  test("слов в числе нет никогда", () => {
    const cases = [
      appt({}),
      appt({ paid_amount: 0, payment_status: "unpaid" }),
      appt({ status: "scheduled", total_amount: 0, paid_amount: 0, payment_status: "unpaid" }),
      appt({ status: "scheduled", paid_amount: 0, payment_status: "unpaid" }),
      appt({ date: "2026-10-04", status: "scheduled", paid_amount: 0, payment_status: "unpaid" }),
      appt({ status: "cancelled" }),
    ];
    for (const c of cases) {
      for (const money of [true, false]) {
        assert.match(visitStatus(c, TODAY, money).text, /^(€[\d\s.,]+)?$/);
      }
    }
  });

  test("прошедшая неоплаченная — долг по правилу сводки; без цены — €0 тихо", () => {
    assert.equal(visitStatus(appt({ status: "scheduled", paid_amount: 0, payment_status: "unpaid" }), TODAY, true).kind, "debt");
    assert.equal(
      visitStatus(appt({ status: "scheduled", total_amount: 0, paid_amount: 0, payment_status: "unpaid" }), TODAY, true).kind,
      "nosum",
    );
  });

  test("оплачено предоплатой, но не отмечена выполненной — зелёным (03.10)", () => {
    const prepaid = appt({ status: "scheduled", paid_amount: 0, prepaid_amount: 100, payment_status: "paid" });
    assert.equal(visitStatus(prepaid, TODAY, true).kind, "paid");
  });

  test("без «Истории» (деньги идут за ней) — чисел нет", () => {
    assert.equal(visitStatus(appt({}), TODAY, false).text, "");
    assert.equal(visitStatus(appt({ paid_amount: 0, payment_status: "unpaid" }), TODAY, false).text, "");
  });
});
