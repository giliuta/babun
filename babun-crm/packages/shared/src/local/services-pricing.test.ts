import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  calcPrice,
  calcSavings,
  calcSlot,
  calcWorkDuration,
  resolveTier,
  roundToSlot,
  type PricedService,
} from "./services-pricing";

function service(patch: Partial<PricedService> = {}): PricedService {
  return {
    serviceType: "quantity",
    pricingMode: "per_unit",
    // Живая кривая AirFix: первый кондиционер дольше второго, потому что в
    // него входит «приехать и разложиться».
    tiers: [
      { fromQty: 1, price: 50, durationMin: 30 },
      { fromQty: 2, price: 50, durationMin: 45 },
      { fromQty: 3, price: 45, durationMin: 75 },
    ],
    variants: [],
    unit: "шт",
    overflowPrice: 45,
    overflowDurationMin: 20,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    ...patch,
  };
}

describe("ступень по количеству", () => {
  test("ниже первого порога действует первая ступень — прайс не отказывает", () => {
    assert.equal(resolveTier(service().tiers, 0.5)?.fromQty, 1);
  });

  test("ровно на границе берётся НОВАЯ ступень, а не предыдущая", () => {
    assert.equal(resolveTier(service().tiers, 3)?.price, 45);
    assert.equal(resolveTier(service().tiers, 2)?.price, 50);
  });

  test("за последним порогом действует последняя ступень", () => {
    assert.equal(resolveTier(service().tiers, 99)?.fromQty, 3);
  });

  test("пустая лестница не выдумывает ступень", () => {
    assert.equal(resolveTier([], 3), null);
  });
});

describe("цена: за единицу", () => {
  test("умножается на количество", () => {
    assert.equal(calcPrice(service(), 2), 100);
    assert.equal(calcPrice(service(), 5), 225); // 5 × 45
  });

  test("одна ступень работает без правила «свыше»", () => {
    const svc = service({
      tiers: [{ fromQty: 1, price: 50, durationMin: 30 }],
      overflowPrice: null,
      overflowDurationMin: null,
    });
    assert.equal(calcPrice(svc, 7), 350);
  });

  test("дробное количество — метры и литры считаются как есть", () => {
    const svc = service({
      unit: "м²",
      tiers: [{ fromQty: 1, price: 12, durationMin: 60 }],
    });
    assert.equal(calcPrice(svc, 45.5), 546);
  });

  test("нулевое, отрицательное и нечисловое количество стоят ноль", () => {
    assert.equal(calcPrice(service(), 0), 0);
    assert.equal(calcPrice(service(), -3), 0);
    assert.equal(calcPrice(service(), Number.NaN), 0);
    assert.equal(calcPrice(service(), Number.POSITIVE_INFINITY), 0);
  });
});

describe("цена: за всё (flat)", () => {
  const flat = service({
    pricingMode: "flat",
    tiers: [
      { fromQty: 1, price: 50, durationMin: 60 },
      { fromQty: 5, price: 200, durationMin: 180 },
    ],
    overflowPrice: 30,
    overflowDurationMin: 25,
  });

  test("итог за диапазон НЕ умножается на количество", () => {
    assert.equal(calcPrice(flat, 3), 50);
    assert.equal(calcPrice(flat, 5), 200);
  });

  test("за последним порогом добавляется правило «свыше» за каждую единицу", () => {
    assert.equal(calcPrice(flat, 7), 260); // 200 + 2 × 30
  });

  test("без правила «свыше» действует последняя ступень, а не ноль", () => {
    const noOverflow = service({ ...flat, overflowPrice: null });
    assert.equal(calcPrice(noOverflow, 7), 200);
  });
});

describe("варианты", () => {
  const rooms = service({
    serviceType: "variant",
    variants: [
      { id: "v1", name: "1-комнатная", price: 50, durationMin: 60 },
      { id: "v2", name: "2-комнатная", price: 75, durationMin: 90 },
    ],
    tiers: [],
  });

  test("цена и время берутся у выбранного варианта, количество не участвует", () => {
    assert.equal(calcPrice(rooms, 3, "v2"), 75);
    assert.equal(calcWorkDuration(rooms, 3, "v2"), 90);
  });

  test("вариант не выбран — ноль, а не цена первого", () => {
    assert.equal(calcPrice(rooms, 1), 0);
    assert.equal(calcWorkDuration(rooms, 1), 0);
  });
});

describe("работа", () => {
  test("время суммарное и нелинейное — в этом весь смысл ступеней", () => {
    assert.equal(calcWorkDuration(service(), 1), 30);
    assert.equal(calcWorkDuration(service(), 2), 45);
    assert.equal(calcWorkDuration(service(), 3), 75);
  });

  test("за последним порогом добавляется «свыше» за каждую единицу", () => {
    assert.equal(calcWorkDuration(service(), 5), 115); // 75 + 2 × 20
  });

  test("час: количество И ЕСТЬ длительность", () => {
    const massage = service({
      unit: "ч",
      tiers: [{ fromQty: 1, price: 40, durationMin: 999 }],
    });
    assert.equal(calcWorkDuration(massage, 2), 120);
    assert.equal(calcPrice(massage, 2), 80);
  });
});

describe("слот в календаре", () => {
  test("округляется ВВЕРХ к шагу сетки", () => {
    assert.equal(roundToSlot(115, 15), 120);
    assert.equal(roundToSlot(120, 15), 120);
    assert.equal(roundToSlot(1, 15), 15);
    assert.equal(roundToSlot(0, 15), 0);
  });

  test("буферы двух услуг берутся МАКСИМАЛЬНЫЕ, а не суммируются", () => {
    const near = service({ bufferBeforeMin: 10, bufferAfterMin: 5 });
    const far = service({ bufferBeforeMin: 30, bufferAfterMin: 0 });
    // работа 30 + 30, буферы max(10,30) до и max(5,0) после = 95 → 105 при 15
    assert.equal(
      calcSlot(
        [
          { service: near, qty: 1 },
          { service: far, qty: 1 },
        ],
        15,
      ),
      105,
    );
  });

  test("пустой выбор не занимает календарь", () => {
    assert.equal(calcSlot([], 15), 0);
  });

  test("мусорный шаг сетки не роняет расчёт", () => {
    assert.equal(roundToSlot(50, 0), 50);
    assert.equal(roundToSlot(50, Number.NaN), 50);
  });
});

describe("экономия по лестнице", () => {
  test("считается против цены первой ступени", () => {
    // 5 × 50 = 250 по первой ступени против 225 фактических
    assert.equal(calcSavings(service(), 5), 25);
  });

  test("на первой ступени экономии нет", () => {
    assert.equal(calcSavings(service(), 1), 0);
  });

  test("у «за всё» и у вариантов сравнивать не с чем", () => {
    assert.equal(calcSavings(service({ pricingMode: "flat" }), 5), 0);
    assert.equal(calcSavings(service({ serviceType: "variant" }), 5), 0);
  });
});
