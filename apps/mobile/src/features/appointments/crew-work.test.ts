import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "@babun/shared/db/database.types";

import { masterAppointmentJsonToAppointment } from "@/features/calendar/master-appointment-mapper";
import { crewMoney, crewWorkLines } from "./crew-work";

/** Запись так, как её собирает приложение из ответа окна мастера. */
function record(overrides: Record<string, Json> = {}) {
  return masterAppointmentJsonToAppointment({
    id: "00000000-0000-4000-8000-000000000001",
    created_by: null,
    tenant_id: "00000000-0000-4000-8000-000000000002",
    client_id: null,
    team_id: "team-1",
    master_id: null,
    location_id: null,
    date: "2026-09-17",
    time_start: "11:00",
    time_end: "12:30",
    kind: "work",
    status: "scheduled",
    comment: "",
    address: "",
    address_note: "",
    address_lat: null,
    address_lng: null,
    cancel_reason: null,
    source: null,
    is_online_booking: false,
    consent_given: false,
    color_override: null,
    reminder_enabled: false,
    reminder_offsets: [],
    reminder_template: "",
    service_ids: ["svc-clean", "svc-gas"],
    total_duration: 120,
    created_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
    event_all_day: false,
    event_notes: "",
    event_url: "",
    event_push_enabled: false,
    event_push_offsets: [],
    event_push_at: null,
    event_repeat: { kind: "none" },
    services: [
      {
        serviceId: "svc-clean",
        serviceName: "Клининг",
        quantity: 4,
        unit: null,
        duration: 120,
        pricePerUnit: 50,
        originalPrice: 50,
        totalPrice: 200,
      },
      {
        serviceId: "svc-gas",
        quantity: 1,
        unit: "м",
        duration: 0,
        pricePerUnit: 100,
        originalPrice: 100,
        totalPrice: 100,
      },
    ],
    total_amount: 280,
    discount_amount: 20,
    paid_amount: 280,
    payment_status: "paid",
    ...overrides,
  });
}

const CATALOG = new Map([["svc-gas", "Заправка фреоном"]]);

describe("работы записи глазами команды", () => {
  test("«Услуги» и «Сумма» видны — строки с ценами", () => {
    const lines = crewWorkLines(record(), CATALOG, { services: true, amount: true });
    assert.deepEqual(
      lines.map((l) => [l.name, l.qty, l.unit, l.minutes, l.pricePerUnit, l.total]),
      [
        ["Клининг", 4, null, 120, 50, 200],
        // Имя из справочника, если снимок записи его не хранит.
        ["Заправка фреоном", 1, "м", 0, 100, 100],
      ],
    );
  });

  test("без «Суммы» — работы есть, цен нет", () => {
    const lines = crewWorkLines(record(), CATALOG, { services: true, amount: false });
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => l.pricePerUnit === null && l.total === null));
  });

  test("без «Услуг» — ни одной строки, даже если данные пришли", () => {
    assert.deepEqual(crewWorkLines(record(), CATALOG, { services: false, amount: true }), []);
  });

  test("старая запись без снимка — имена из справочника, без цен", () => {
    const lines = crewWorkLines(record({ services: [] }), CATALOG, { services: true, amount: true });
    assert.deepEqual(
      lines.map((l) => [l.name, l.total]),
      [
        ["Услуга удалена", null],
        ["Заправка фреоном", null],
      ],
    );
  });
});

describe("деньги записи глазами команды", () => {
  test("«Сумма» и «Оплата» видны — итог, скидка, внесено", () => {
    assert.deepEqual(crewMoney(record(), { amount: true, payment: "read" }), {
      total: 280,
      discount: 20,
      payment: { word: "Оплачено", paid: 280 },
    });
  });

  test("без «Суммы» — статус оплаты словом, без цифр", () => {
    assert.deepEqual(crewMoney(record(), { amount: false, payment: "read" }), {
      total: null,
      discount: null,
      payment: { word: "Оплачено", paid: null },
    });
  });

  test("без «Оплаты» — строки оплаты нет", () => {
    assert.equal(crewMoney(record(), { amount: true, payment: "hidden" }).payment, null);
  });

  test("закрытая сервером сумма читается нулями, а не выдумкой", () => {
    const hidden = record({ total_amount: 0, discount_amount: 0, paid_amount: 0, payment_status: "unpaid" });
    assert.deepEqual(crewMoney(hidden, { amount: true, payment: "read" }), {
      total: 0,
      discount: null,
      payment: { word: "Не оплачено", paid: null },
    });
  });
});
