import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addMinutesHM,
  buildServices,
  parseYMD,
  minutesBetweenHM,
  parseMoneyInput,
} from "./helpers";
import type { Service } from "@/features/services/queries";

function makeService(patch: Partial<Service> = {}): Service {
  return {
    available_weekdays: [],
    brigade_ids: [],
    bulk_price: 0,
    bulk_threshold: 0,
    category_id: null,
    color: "#2C5BE0",
    cost_per_unit: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    duration_minutes: 60,
    duration_tiers: null,
    id: "service-one",
    is_active: true,
    is_countable: true,
    material_costs: [],
    name: "Услуга",
    online_enabled: true,
    position: 0,
    price: 20,
    price_tiers: null,
    tenant_id: "tenant-one",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("appointment time helpers", () => {
  test("persists the actual duration of a service-free booking", () => {
    assert.equal(minutesBetweenHM("09:15", "10:45"), 90);
  });

  test("rejects reversed, malformed, and cross-midnight ranges", () => {
    assert.equal(minutesBetweenHM("11:00", "10:00"), 0);
    assert.equal(minutesBetweenHM("bad", "10:00"), 0);
    assert.equal(minutesBetweenHM("23:45", "00:15"), 0);
  });

  test("clamps generated end time to the same calendar day", () => {
    assert.equal(addMinutesHM("23:45", 60), "23:59");
  });
});

describe("appointment money input", () => {
  test("accepts EU decimal comma and rejects negative values", () => {
    assert.equal(parseMoneyInput("120,50"), 120.5);
    assert.equal(parseMoneyInput("-1"), 0);
  });
});

describe("appointment service economics", () => {
  test("applies the highest price and total-duration tier", () => {
    const service = makeService({
      price_tiers: [
        { min_qty: 5, price_per_unit: 12 },
        { min_qty: 3, price_per_unit: 15 },
        { malformed: true },
      ],
      duration_tiers: [
        { min_qty: 3, duration_minutes: 120 },
        { min_qty: 5, duration_minutes: 150 },
      ],
    });
    const catalog = new Map([[service.id, service]]);

    const [lineAtThree] = buildServices(
      [service.id],
      catalog,
      { [service.id]: { qty: 3 } },
    );
    assert.equal(lineAtThree.quantity, 3);
    assert.equal(lineAtThree.pricePerUnit, 15);
    assert.equal(lineAtThree.totalPrice, 45);
    assert.equal(lineAtThree.duration, 120);

    const [lineAtFive] = buildServices(
      [service.id],
      catalog,
      { [service.id]: { qty: 5 } },
    );
    assert.equal(lineAtFive.pricePerUnit, 12);
    assert.equal(lineAtFive.duration, 150);
  });

  test("forces non-countable services to one unit", () => {
    const service = makeService({
      is_countable: false,
      price_tiers: [{ min_qty: 2, price_per_unit: 1 }],
      duration_tiers: [{ min_qty: 2, duration_minutes: 10 }],
    });
    const [line] = buildServices(
      [service.id],
      new Map([[service.id, service]]),
      { [service.id]: { qty: 8 } },
    );

    assert.equal(line.quantity, 1);
    assert.equal(line.pricePerUnit, 20);
    assert.equal(line.totalPrice, 20);
    assert.equal(line.duration, 60);
  });

  test("falls back safely when tier JSON is malformed", () => {
    const service = makeService({
      price_tiers: "broken" as Service["price_tiers"],
      duration_tiers: [{ min_qty: 2, duration_minutes: -10 }],
    });
    const [line] = buildServices(
      [service.id],
      new Map([[service.id, service]]),
      { [service.id]: { qty: 2 } },
    );

    assert.equal(line.pricePerUnit, 20);
    assert.equal(line.duration, 120);
  });
});

// Дата записи в системном календаре: неверный разбор виден сразу — вместо
// дня работы стоит «1 янв. 1970 г.», и сохранение уносит запись в 1970-й.
describe("parseYMD", () => {
  test("обычная дата", () => {
    const d = parseYMD("2026-05-31");
    assert.deepEqual(
      [d.getFullYear(), d.getMonth() + 1, d.getDate()],
      [2026, 5, 31],
    );
  });

  test("ISO-штамп из кэша не ломает день", () => {
    const d = parseYMD("2026-05-31T00:00:00.000Z");
    assert.deepEqual(
      [d.getFullYear(), d.getMonth() + 1, d.getDate()],
      [2026, 5, 31],
    );
  });

  test("мусор откатывается на сегодня, а не на 1970-й", () => {
    assert.ok(parseYMD("").getFullYear() > 2000);
    assert.ok(parseYMD("не дата").getFullYear() > 2000);
  });
});
