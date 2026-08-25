import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "@babun/shared/db/database.types";
import { masterAppointmentJsonToAppointment } from "./master-appointment-mapper";

function rpcRow(overrides: Record<string, Json> = {}): Json {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    created_by: "00000000-0000-4000-8000-000000000004",
    tenant_id: "00000000-0000-4000-8000-000000000002",
    client_id: "00000000-0000-4000-8000-000000000003",
    team_id: "team-1",
    master_id: "master-1",
    location_id: null,
    date: "2026-07-20",
    time_start: "09:00",
    time_end: "10:30",
    kind: "work",
    status: "in_progress",
    comment: "Позвонить за 15 минут",
    address: "1 Main Street",
    address_note: "Зелёная дверь",
    address_lat: 35.1,
    address_lng: 33.2,
    cancel_reason: null,
    source: "phone",
    is_online_booking: false,
    consent_given: true,
    color_override: null,
    reminder_enabled: true,
    reminder_offsets: [60],
    reminder_template: "Напоминание",
    service_ids: ["service-1"],
    total_duration: 90,
    created_at: "2026-07-20T08:00:00.000Z",
    updated_at: "2026-07-20T08:30:00.000Z",
    event_all_day: false,
    event_notes: "",
    event_url: "",
    event_push_enabled: false,
    event_push_offsets: [],
    event_push_at: null,
    event_repeat: { kind: "none" },
    ...overrides,
  };
}

describe("master appointment RPC mapper", () => {
  test("keeps operational fields but discards every raw finance value", () => {
    const appointment = masterAppointmentJsonToAppointment(
      rpcRow({
        total_amount: 980,
        custom_total: true,
        discount_amount: 80,
        prepaid_amount: 200,
        paid_amount: 700,
        payment_status: "paid",
        payment_method: "card",
        payments: [{ id: "pay", method: "card", amount: 700 }],
        payment: {
          method: "card",
          cashAmount: 0,
          cardAmount: 700,
          paid_at: "2026-07-20T10:30:00.000Z",
        },
        expenses: [{ id: "expense", name: "Материалы", amount: 120 }],
        services: [{ serviceId: "service-1", pricePerUnit: 980 }],
        service_price_overrides: { "service-1": 980 },
        global_discount: { type: "fixed", value: 80 },
      }),
    );

    assert.equal(appointment.id, "00000000-0000-4000-8000-000000000001");
    assert.equal(appointment.created_by, "00000000-0000-4000-8000-000000000004");
    assert.equal(appointment.status, "in_progress");
    assert.equal(appointment.comment, "Позвонить за 15 минут");
    assert.deepEqual(appointment.service_ids, ["service-1"]);
    assert.equal(appointment.total_amount, 0);
    assert.equal(appointment.custom_total, false);
    assert.equal(appointment.discount_amount, 0);
    assert.equal(appointment.prepaid_amount, 0);
    assert.equal(appointment.paid_amount, 0);
    assert.equal(appointment.payment_status, "unpaid");
    assert.equal(appointment.payment_method, undefined);
    assert.deepEqual(appointment.payments, []);
    assert.equal(appointment.payment, null);
    assert.deepEqual(appointment.expenses, []);
    assert.deepEqual(appointment.services, []);
    assert.deepEqual(appointment.service_price_overrides, {});
    assert.equal(appointment.global_discount, null);
  });

  test("fails closed on an unscoped or malformed row", () => {
    assert.throws(
      () =>
        masterAppointmentJsonToAppointment(
          rpcRow({ tenant_id: null }),
        ),
      /некорректную заявку/,
    );
    assert.throws(
      () => masterAppointmentJsonToAppointment(rpcRow({ status: "unknown" })),
      /неизвестный статус/,
    );
  });
});
