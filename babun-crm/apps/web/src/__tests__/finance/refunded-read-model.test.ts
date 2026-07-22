import { describe, expect, it } from "vitest";
import {
  createBlankAppointment,
  getDebtAmount,
  getPaidAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import { computeDayFinance } from "@babun/shared/local/finance/day-summary";
import { buildStats } from "@babun/shared/local/selectors/client-stats";

function refundedAppointment(): Appointment {
  return createBlankAppointment({
    id: "apt-refunded",
    date: "2026-07-20",
    time_start: "10:00",
    time_end: "11:00",
    client_id: "client-1",
    location_id: null,
    team_id: "team-1",
    service_ids: [],
    services: [],
    total_amount: 100,
    custom_total: false,
    discount_amount: 0,
    expenses: [],
    service_price_overrides: {},
    color_override: null,
    prepaid_amount: 20,
    payments: [
      { id: "payment-1", method: "card", amount: 80, paid_at: "2026-07-20" },
    ],
    payment: {
      method: "card",
      cashAmount: 0,
      cardAmount: 80,
      paid_at: "2026-07-20T11:00:00Z",
    },
    payment_status: "refunded",
    payment_method: "card",
    paid_amount: 0,
    global_discount: null,
    total_duration: 60,
    comment: "",
    address: "",
    address_note: "",
    status: "completed",
    kind: "work",
    source: null,
    photos: [],
    consent_given: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  });
}

describe("refunded appointment read model", () => {
  it("keeps historical mirrors out of current paid and debt totals", () => {
    const appointment = refundedAppointment();
    expect(getPaidAmount(appointment)).toBe(0);
    expect(getDebtAmount(appointment)).toBe(0);
  });

  it("contributes no day revenue, planned revenue, or tender", () => {
    const totals = computeDayFinance([refundedAppointment()], [], []);
    expect(totals).toMatchObject({
      planned: 0,
      earned: 0,
      profit: 0,
      byMethod: { cash: 0, card: 0, transfer: 0, other: 0 },
    });
  });

  it("does not turn a refunded completed visit into client spend or debt", () => {
    const stats = buildStats(
      {
        id: "client-1",
        full_name: "Client",
        created_at: "2026-01-01T00:00:00Z",
        birthday: "",
      },
      [refundedAppointment()],
    );
    expect(stats.visits).toBe(1);
    expect(stats.totalSpent).toBe(0);
    expect(stats.debt).toBe(0);
  });
});
