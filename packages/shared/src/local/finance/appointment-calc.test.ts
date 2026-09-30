import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBlankAppointment } from "../appointments";
import { createBlankService } from "../services";
import {
  appointmentMaterialCost,
  appointmentMaterialCostLines,
  appointmentOverpaidCents,
  liveMaterialCostLines,
  type MaterialCatalogService,
} from "./appointment-calc";
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

  test("feeds quantity-aware expenses into day finance", () => {
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
  });
});

describe("appointmentOverpaidCents", () => {
  test("оплатили ровно или недоплатили — переплаты нет", () => {
    assert.equal(appointmentOverpaidCents(255, 255), 0);
    assert.equal(appointmentOverpaidCents(255, 100), 0);
  });

  test("итог опустили ниже оплаченного — переплата видна", () => {
    // Заплатили €255, потом итог стал €200: долга нет, но €55 лишние.
    assert.equal(appointmentOverpaidCents(200, 255), 5500);
  });

  test("копейки считаются в центах, а не в плавающей точке", () => {
    assert.equal(appointmentOverpaidCents(10.1, 10.35), 25);
  });

  test("возвращённая запись переплаты не показывает", () => {
    assert.equal(appointmentOverpaidCents(200, 255, "refunded"), 0);
  });

  test("мусор вместо чисел не ломает счёт", () => {
    assert.equal(appointmentOverpaidCents(Number.NaN, 255), 0);
  });
});

// ЗЕРКАЛО СЕРВЕРА (30.09). Тот же набор примеров прогоняется через
// `appointment_material_lines` (миграция 20260930235800) в откатываемой
// транзакции на боевой базе, и ответы совпадают строка в строку. Меняешь
// правило здесь — меняй и там, и прогоняй оба. Поля справочника — как в
// базе: `cost_per_unit`, `cost_tiers`, `material_costs` не бывают NULL.
export const MIRROR_CATALOG = [
  { id: "svc-a", name: "Чистка", cost_per_unit: 10, cost_tiers: [], material_costs: [] },
  {
    id: "svc-b",
    name: " Заправка ",
    cost_per_unit: 0,
    cost_tiers: [],
    material_costs: [{ amount: 5 }, { amount: "3" }, { amount: -1 }],
  },
  { id: "svc-c", name: "", cost_per_unit: 4, cost_tiers: [], material_costs: [{ amount: 7 }] },
  {
    id: "svc-d",
    name: "Монтаж",
    cost_per_unit: 10,
    cost_tiers: [
      { min_qty: 3, cost_per_unit: 8 },
      { min_qty: 5, cost_per_unit: 6 },
      { min_qty: 1, cost_per_unit: 1 },
      { min_qty: "4", cost_per_unit: "7" },
      { min_qty: 5, cost_per_unit: 5 },
    ],
    material_costs: [],
  },
  { id: "svc-e", name: "Осмотр", cost_per_unit: 0, cost_tiers: [], material_costs: [] },
  {
    id: "svc-f",
    name: "Нулевая ступень",
    cost_per_unit: 3,
    cost_tiers: [{ min_qty: 2, cost_per_unit: null }],
    material_costs: [],
  },
] as unknown as MaterialCatalogService[];

export const MIRROR_CASES: {
  services: unknown;
  service_ids: unknown;
  expect: string;
}[] = [
  { services: [{ serviceId: "svc-a", quantity: 2 }], service_ids: [], expect: "svc-a|Чистка|2|20" },
  { services: [{ serviceId: "svc-b", quantity: 2.7 }], service_ids: [], expect: "svc-b|Заправка|2|10" },
  { services: [{ serviceId: "svc-c", quantity: 0 }], service_ids: [], expect: "svc-c|Услуга|1|4" },
  { services: [{ serviceId: "svc-d", quantity: 4 }], service_ids: [], expect: "svc-d|Монтаж|4|28" },
  { services: [{ serviceId: "svc-d", quantity: 5 }], service_ids: [], expect: "svc-d|Монтаж|5|25" },
  { services: [{ serviceId: "svc-d", quantity: "3" }], service_ids: [], expect: "svc-d|Монтаж|1|10" },
  { services: [], service_ids: ["svc-a", "svc-a", "svc-e"], expect: "svc-a|Чистка|2|20" },
  {
    services: [{ serviceId: "svc-a", quantity: 1 }],
    service_ids: ["svc-a", "svc-b"],
    expect: "svc-a|Чистка|1|10;svc-b|Заправка|1|5",
  },
  { services: [{ serviceId: "svc-missing", quantity: 1 }], service_ids: [], expect: "" },
  { services: [{ serviceId: "svc-f", quantity: 2 }], service_ids: [], expect: "" },
  { services: [{ serviceId: "svc-f", quantity: 1 }], service_ids: [], expect: "svc-f|Нулевая ступень|1|3" },
  {
    services: [
      { serviceId: "svc-a", quantity: 1 },
      { serviceId: "svc-a", quantity: 2 },
    ],
    service_ids: [],
    expect: "svc-a|Чистка|3|30",
  },
];

describe("материалы — зеркало сервера", () => {
  test("живой расчёт по справочнику — ответы набора примеров", () => {
    for (const c of MIRROR_CASES) {
      const got = liveMaterialCostLines(
        { services: c.services, service_ids: c.service_ids },
        MIRROR_CATALOG,
      )
        .map((l) => `${l.serviceId}|${l.serviceName}|${l.quantity}|${l.totalCost}`)
        .join(";");
      assert.equal(got, c.expect, JSON.stringify(c.services));
    }
  });

  test("снимок сервера сильнее справочника: цена поменялась — прибыль прошлого нет", () => {
    const appointment = {
      services: [{ serviceId: "svc-a", quantity: 2 }],
      material_lines: [
        { serviceId: "svc-a", serviceName: "Чистка", quantity: 2, unitCost: 6, totalCost: 12 },
      ],
    };
    assert.equal(appointmentMaterialCost(appointment, MIRROR_CATALOG), 12);
    // Пустой снимок — «материалов не было», а не «считай заново».
    assert.equal(appointmentMaterialCost({ ...appointment, material_lines: [] }, MIRROR_CATALOG), 0);
  });

  test("битый снимок не принимается — считаем по справочнику", () => {
    const appointment = {
      services: [{ serviceId: "svc-a", quantity: 2 }],
      material_lines: [{ serviceId: "svc-a", totalCost: "много" }],
    };
    assert.equal(appointmentMaterialCost(appointment, MIRROR_CATALOG), 20);
    assert.equal(appointmentMaterialCost({ ...appointment, material_lines: null }, MIRROR_CATALOG), 20);
  });
});
