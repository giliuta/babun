import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { durationForQuantity, pricePerUnit } from "./services";

// ЛЕСТНИЦА КОЛИЧЕСТВА — ядро прайса: по ней считается и сумма записи, и время
// в календаре. Ошибка здесь не видна на экране настроек, а вылезает опозданием
// команды на вечерний адрес, поэтому примеры взяты живые — те, что диктовал
// владелец 2026-08-18.

const duration = (
  base: number,
  tiers: { min_qty: number; duration_minutes: number }[] | null,
) => ({ duration_minutes: base, duration_tiers: tiers });

const price = (
  base: number,
  tiers: { min_qty: number; price_per_unit: number }[] | null,
) => ({
  price: base,
  price_tiers: tiers,
  bulk_threshold: 0,
  bulk_price: 0,
});

describe("цена от количества", () => {
  test("кондиционеры: 50,01 € за штуку, от трёх — по 45", () => {
    const ac = price(50.01, [{ min_qty: 3, price_per_unit: 45 }]);
    assert.equal(pricePerUnit(ac, 1), 50.01);
    assert.equal(pricePerUnit(ac, 2), 50.01);
    assert.equal(pricePerUnit(ac, 3), 45);
    assert.equal(pricePerUnit(ac, 10), 45);
  });

  test("две ступени: комната 100 €, от трёх — 95, от пяти — 90", () => {
    const room = price(100, [
      { min_qty: 3, price_per_unit: 95 },
      { min_qty: 5, price_per_unit: 90 },
    ]);
    assert.deepEqual(
      [1, 3, 4, 5, 6].map((q) => pricePerUnit(room, q)),
      [100, 95, 95, 90, 90],
    );
  });
});

describe("время от количества", () => {
  test("без ступеней время просто множится", () => {
    assert.equal(durationForQuantity(duration(45, null), 3), 135);
  });

  test("между якорями время идёт по прямой, а не скачком", () => {
    // 45 мин за один сплит, три сплита за 1 ч 45 — значит два за 1 ч 15.
    const ac = duration(45, [{ min_qty: 3, duration_minutes: 105 }]);
    assert.equal(durationForQuantity(ac, 1), 45);
    assert.equal(durationForQuantity(ac, 2), 75);
    assert.equal(durationForQuantity(ac, 3), 105);
  });

  test("после последнего якоря время РАСТЁТ, а не замирает", () => {
    // Главный дефект прежнего чтения: и четыре, и десять сплитов занимали те
    // же 105 минут, и календарь врал команде.
    const ac = duration(45, [{ min_qty: 3, duration_minutes: 105 }]);
    assert.equal(durationForQuantity(ac, 4), 135);
    assert.equal(durationForQuantity(ac, 10), 315);
  });

  test("клининговая лестница описывается ДВУМЯ ступенями", () => {
    const rooms = duration(120, [
      { min_qty: 3, duration_minutes: 240 },
      { min_qty: 5, duration_minutes: 330 },
    ]);
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((q) => durationForQuantity(rooms, q)),
      [120, 180, 240, 285, 330, 375],
    );
  });

  test("«время не растёт» — якорь с тем же значением", () => {
    // Две собаки гуляют вместе тот же час.
    const walk = duration(60, [{ min_qty: 2, duration_minutes: 60 }]);
    assert.deepEqual(
      [1, 2, 3, 5].map((q) => durationForQuantity(walk, q)),
      [60, 60, 60, 60],
    );
  });

  test("мусор в ступенях не роняет расчёт", () => {
    const broken = duration(30, [
      { min_qty: 1, duration_minutes: 10 },
      { min_qty: 3, duration_minutes: 60 },
    ] as { min_qty: number; duration_minutes: number }[]);
    // Порог 1 отбрасывается (пороги от двух), остаётся якорь на трёх.
    assert.equal(durationForQuantity(broken, 3), 60);
    assert.equal(durationForQuantity(broken, 0), 30);
  });
});
