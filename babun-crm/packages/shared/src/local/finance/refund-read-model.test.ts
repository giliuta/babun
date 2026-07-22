import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createBlankAppointment,
  getDebtAmount,
  getPaidAmount,
  getRecognizedRevenue,
  isFullyPaid,
} from "../appointments";
import { createBlankClient, getClientDebt } from "../clients";
import { buildStats } from "../selectors/client-stats";
import { computeFinancials } from "./compute";
import { computeDayFinance } from "./day-summary";

describe("fully refunded appointment read model", () => {
  test("keeps history while netting revenue, debt, and tender to zero", () => {
    const client = createBlankClient({
      id: "client-refund",
      full_name: "Клиент с возвратом",
      created_at: "2026-07-01T08:00:00.000Z",
    });
    const appointment = createBlankAppointment({
      id: "appointment-refund",
      client_id: client.id,
      date: "2026-07-20",
      status: "completed",
      total_amount: 120,
      prepaid_amount: 20,
      payments: [
        {
          id: "receipt-before-refund",
          method: "cash",
          amount: 100,
          paid_at: "2026-07-20T10:00:00.000Z",
        },
      ],
      payment: {
        method: "cash",
        cashAmount: 100,
        cardAmount: 0,
        paid_at: "2026-07-20T10:00:00.000Z",
      },
      payment_status: "refunded",
      payment_method: "cash",
      paid_amount: 100,
    });

    assert.equal(getPaidAmount(appointment), 0);
    assert.equal(getDebtAmount(appointment), 0);
    assert.equal(getRecognizedRevenue(appointment), 0);
    assert.equal(isFullyPaid(appointment), false);
    assert.equal(getClientDebt(client.id, [appointment]), 0);

    const stats = buildStats(client, [appointment]);
    assert.equal(stats.visits, 1, "the completed visit remains in history");
    assert.equal(stats.lastVisitDate, appointment.date);
    assert.equal(stats.totalSpent, 0);
    assert.equal(stats.debt, 0);

    const day = computeDayFinance([appointment], [], []);
    assert.equal(day.planned, 0);
    assert.equal(day.earned, 0);
    assert.deepEqual(day.byMethod, {
      cash: 0,
      card: 0,
      transfer: 0,
      other: 0,
    });

    const range = computeFinancials({
      appointments: [appointment],
      services: [],
      teams: [],
      dayExtrasOf: () => [],
      standalonePayments: [],
      standaloneExpenses: [],
      range: { from: appointment.date, to: appointment.date },
    });
    assert.equal(range.totalIncome, 0);
    assert.deepEqual(range.incomeLines, []);
    assert.equal(range.cash, 0);
    assert.equal(range.card, 0);
    assert.equal(range.transfer, 0);
    assert.equal(range.otherPayment, 0);

    assert.equal(appointment.payment_status, "refunded");
    assert.equal(appointment.payments.length, 1, "receipt history is preserved");
  });

  test("does not change the partial-payment debt lifecycle", () => {
    const appointment = createBlankAppointment({
      status: "completed",
      total_amount: 120,
      prepaid_amount: 20,
      payments: [
        {
          id: "partial-receipt",
          method: "card",
          amount: 40,
          paid_at: "2026-07-20T10:00:00.000Z",
        },
      ],
      payment_status: "partial",
      payment_method: "card",
      paid_amount: 40,
    });

    assert.equal(getPaidAmount(appointment), 60);
    assert.equal(getDebtAmount(appointment), 60);
    assert.equal(getRecognizedRevenue(appointment), 120);

    const day = computeDayFinance([appointment], [], []);
    assert.equal(day.planned, 120);
    assert.equal(day.earned, 60);
    assert.equal(day.byMethod.card, 60);
  });

  test("undoing a mistaken tender reopens debt instead of becoming a refund", () => {
    const appointment = createBlankAppointment({
      status: "completed",
      total_amount: 120,
      payments: [],
      payment: null,
      payment_status: "unpaid",
      payment_method: undefined,
      // A stale scalar mirror must not revive the tender after the undo RPC
      // has explicitly returned the lifecycle to unpaid.
      paid_amount: 120,
    });

    assert.equal(getPaidAmount(appointment), 0);
    assert.equal(getDebtAmount(appointment), 120);
    assert.equal(getRecognizedRevenue(appointment), 120);
  });
});
