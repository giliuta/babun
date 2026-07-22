import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBlankAppointment } from "../appointments";
import { createBlankService } from "../services";
import {
  appointmentMaterialCost,
  appointmentMaterialCostLines,
} from "./appointment-calc";
import { computeFinancials } from "./compute";
import { computeDayFinance } from "./day-summary";

describe("appointment material cost", () => {
  test("uses the saved quantity snapshot and falls back for legacy service ids", () => {
    const cost = appointmentMaterialCost(
      {
        service_ids: ["clean", "visit"],
        services: [{ serviceId: "clean", quantity: 3 }],
      },
      [
        {
          id: "clean",
          name: "Чистка",
          cost_per_unit: 5,
          material_costs: [],
        },
        {
          id: "visit",
          name: "Выезд",
          cost_per_unit: 0,
          material_costs: [{ id: "fuel", name: "Топливо", amount: 2 }],
        },
      ],
    );

    assert.equal(cost, 17);
  });

  test("normalizes malformed quantities and ignores unknown services", () => {
    const lines = appointmentMaterialCostLines(
      {
        service_ids: ["known"],
        services: [
          { serviceId: "known", quantity: -4 },
          { serviceId: "missing", quantity: 10 },
          { serviceId: 42, quantity: 3 },
          null,
        ],
      },
      [{ id: "known", cost_per_unit: 4, material_costs: [] }],
    );

    assert.deepEqual(lines, [
      {
        serviceId: "known",
        serviceName: "Услуга",
        quantity: 1,
        unitCost: 4,
        totalCost: 4,
      },
    ]);
  });

  test("feeds quantity-aware expenses into day and range finance", () => {
    const service = createBlankService({
      id: "service",
      name: "Чистка",
      cost_per_unit: 6,
    });
    const appointment = createBlankAppointment({
      id: "appointment",
      date: "2026-07-20",
      status: "completed",
      service_ids: [service.id],
      services: [
        {
          serviceId: service.id,
          quantity: 4,
          pricePerUnit: 20,
          originalPrice: 20,
          totalPrice: 80,
          duration: 120,
        },
      ],
      total_amount: 80,
    });

    const day = computeDayFinance([appointment], [service], []);
    assert.equal(day.spent, 24);
    assert.equal(day.profit, -24);

    const range = computeFinancials({
      appointments: [appointment],
      services: [service],
      teams: [],
      dayExtrasOf: () => [],
      standalonePayments: [],
      standaloneExpenses: [],
      range: { from: "2026-07-20", to: "2026-07-20" },
    });
    assert.equal(range.totalExpense, 24);
    assert.equal(range.expenseLines[0]?.amount, 24);
    assert.equal(range.expenseLines[0]?.description, "Материалы: Чистка");
  });

  test("attributes prepayment to its persisted payment method", () => {
    const cardPrepaid = createBlankAppointment({
      id: "card-prepaid",
      date: "2026-07-20",
      status: "completed",
      total_amount: 80,
      prepaid_amount: 25,
      payment_method: "card",
    });
    const legacyPrepaid = createBlankAppointment({
      id: "legacy-prepaid",
      date: "2026-07-20",
      status: "completed",
      total_amount: 40,
      prepaid_amount: 10,
      payment_method: undefined,
    });

    const day = computeDayFinance([cardPrepaid, legacyPrepaid], [], []);
    assert.equal(day.byMethod.cash, 0);
    assert.equal(day.byMethod.card, 25);
    assert.equal(day.byMethod.transfer, 0);
    assert.equal(day.byMethod.other, 10);

    const range = computeFinancials({
      appointments: [cardPrepaid, legacyPrepaid],
      services: [],
      teams: [],
      dayExtrasOf: () => [],
      standalonePayments: [],
      standaloneExpenses: [],
      range: { from: "2026-07-20", to: "2026-07-20" },
    });
    assert.equal(range.cash, 0);
    assert.equal(range.card, 25);
    assert.equal(range.transfer, 0);
    assert.equal(range.otherPayment, 10);
  });

  test("keeps transfer separate from other appointment payments", () => {
    const appointment = createBlankAppointment({
      id: "non-cash-payment",
      date: "2026-07-20",
      status: "completed",
      total_amount: 18,
      payments: [
        {
          id: "transfer-payment",
          method: "transfer",
          amount: 11,
          paid_at: "2026-07-20T10:00:00.000Z",
        },
        {
          id: "other-payment",
          method: "other",
          amount: 7,
          paid_at: "2026-07-20T10:01:00.000Z",
        },
      ],
    });

    const day = computeDayFinance([appointment], [], []);
    assert.equal(day.byMethod.transfer, 11);
    assert.equal(day.byMethod.other, 7);

    const range = computeFinancials({
      appointments: [appointment],
      services: [],
      teams: [],
      dayExtrasOf: () => [],
      standalonePayments: [],
      standaloneExpenses: [],
      range: { from: "2026-07-20", to: "2026-07-20" },
    });
    assert.equal(range.transfer, 11);
    assert.equal(range.otherPayment, 7);
  });
});
