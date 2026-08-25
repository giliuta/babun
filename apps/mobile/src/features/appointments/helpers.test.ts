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
    description: null,
    category_id: null,
    color: "#2C5BE0",
    cost_per_unit: 0,
    cost_tiers: [],
    created_at: "2026-01-01T00:00:00.000Z",
    duration_minutes: 60,
    duration_tiers: null,
    team_id: "team-1",
    id: "service-one",
    is_active: true,
    material_costs: [],
    name: "Услуга",
    online_enabled: true,
    position: 0,
    price: 20,
    buffer_before_min: 0,
    buffer_after_min: 0,
    required_staff: 1,
    service_type: "quantity",
    min_qty: 1,
    max_qty: null,
    overflow_price: null,
    overflow_duration_min: null,
    copied_from_service_id: null,
    price_entry: "total",
    price_tiers: null,
    unit: null,
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

  test("quantity survives even when the catalogue changed under the line", () => {
    // Флага «продаём целиком» больше нет, и правило только расширилось: любое
    // уже записанное количество остаётся при себе, ни один байт снимка
    // оплаченной записи не переписывается.
    const service = makeService({});
    const [line] = buildServices(
      [service.id],
      new Map([[service.id, service]]),
      { [service.id]: { qty: 8 } },
    );

    assert.equal(line.quantity, 8);
    assert.equal(line.totalPrice, 160);
  });

  test("the lock keeps a stored line at the numbers it was written with", () => {
    // Прайс подорожал вдвое и лестница переписана — сохранённая строка обязана
    // остаться собой, иначе открытие майской записи переписывает её деньги.
    const service = makeService({
      price: 120,
      duration_minutes: 90,
      price_tiers: [{ min_qty: 2, price_per_unit: 100 }],
      duration_tiers: [{ min_qty: 2, duration_minutes: 200 }],
    });
    const [line] = buildServices([service.id], new Map([[service.id, service]]), {
      [service.id]: {
        qty: 2,
        locked: { pricePerUnit: 50, originalPrice: 60, duration: 120 },
      },
    });

    assert.equal(line.pricePerUnit, 50);
    assert.equal(line.totalPrice, 100);
    assert.equal(line.duration, 120);
    // Цена каталога ТОГО дня: иначе байт снимка меняется от одного открытия
    // и сторож оплаченной записи просыпается на правке комментария.
    assert.equal(line.originalPrice, 60);
  });

  test("an operator price still wins over the lock", () => {
    const service = makeService({ price: 120 });
    const [line] = buildServices([service.id], new Map([[service.id, service]]), {
      [service.id]: {
        qty: 1,
        price: 80,
        locked: { pricePerUnit: 50, originalPrice: 60, duration: 120 },
      },
    });

    assert.equal(line.pricePerUnit, 80);
    // Длительность и цена каталога остаются из снимка — замок держит их.
    assert.equal(line.duration, 120);
    assert.equal(line.originalPrice, 60);
  });

  test("dropping the lock re-prices the line by today's ladder", () => {
    // Так выглядит правка количества: замок снят, строка считается заново.
    const service = makeService({
      price: 120,
      duration_minutes: 90,
      price_tiers: [{ min_qty: 2, price_per_unit: 100 }],
      duration_tiers: [{ min_qty: 2, duration_minutes: 200 }],
    });
    const [line] = buildServices([service.id], new Map([[service.id, service]]), {
      [service.id]: { qty: 2 },
    });

    assert.equal(line.pricePerUnit, 100);
    assert.equal(line.duration, 200);
    assert.equal(line.originalPrice, 120);
  });

  test("the lock survives a service that vanished from the catalogue", () => {
    const [line] = buildServices(["gone"], new Map(), {
      gone: {
        qty: 3,
        locked: { pricePerUnit: 40, originalPrice: 40, duration: 150 },
      },
    });

    assert.equal(line.pricePerUnit, 40);
    assert.equal(line.totalPrice, 120);
    assert.equal(line.duration, 150);
  });

  test("снимок помнит имя услуги на день записи", () => {
    const service = makeService({ name: "Чистка сплит-системы", unit: "шт" });
    const [line] = buildServices([service.id], new Map([[service.id, service]]));
    assert.equal(line.serviceName, "Чистка сплит-системы");
    assert.equal(line.unit, "шт");
  });

  test("переименование услуги НЕ переписывает прошлую запись", () => {
    // Услуга в каталоге называется уже иначе, но у строки есть замок с тем
    // именем, которым работу назвали тогда.
    const renamed = makeService({ name: "Чистка сплит-системы X-line" });
    const [line] = buildServices([renamed.id], new Map([[renamed.id, renamed]]), {
      [renamed.id]: {
        qty: 1,
        locked: {
          pricePerUnit: 50,
          originalPrice: 50,
          duration: 60,
          serviceName: "Чистка",
          unit: null,
        },
      },
    });
    assert.equal(line.serviceName, "Чистка");
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

describe("услуга с вариантами в записи", () => {
  const rooms = makeService({
    id: "svc-rooms",
    name: "Уборка квартиры",
    service_type: "variant",
    price: 50,
    duration_minutes: 60,
  });
  const variants = new Map([
    [
      "svc-rooms",
      [
        { id: "v1", name: "1-комнатная", price: 50, durationMin: 60 },
        { id: "v2", name: "3-комнатная", price: 100, durationMin: 120 },
      ],
    ],
  ]);

  test("цена и время берутся у выбранного варианта, а не у лестницы", () => {
    const [line] = buildServices(
      ["svc-rooms"],
      new Map([["svc-rooms", rooms]]),
      { "svc-rooms": { qty: 1, variantId: "v2" } },
      variants,
    );
    assert.equal(line.pricePerUnit, 100);
    assert.equal(line.duration, 120);
    assert.equal(line.variantId, "v2");
  });

  test("КОЛИЧЕСТВО НЕ УМНОЖАЕТ ВАРИАНТ: трёхкомнатная — не «три раза комната»", () => {
    const [line] = buildServices(
      ["svc-rooms"],
      new Map([["svc-rooms", rooms]]),
      { "svc-rooms": { qty: 1, variantId: "v1" } },
      variants,
    );
    assert.equal(line.pricePerUnit, 50);
    assert.equal(line.totalPrice, 50);
  });

  test("вариант не выбран — цена услуги, а не ноль: строка не исчезает", () => {
    const [line] = buildServices(
      ["svc-rooms"],
      new Map([["svc-rooms", rooms]]),
      { "svc-rooms": { qty: 1 } },
      variants,
    );
    assert.equal(line.pricePerUnit, 50);
  });
});
