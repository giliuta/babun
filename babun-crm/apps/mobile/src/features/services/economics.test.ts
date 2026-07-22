import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  economicsDraftFromService,
  parseDurationTiers,
  parsePriceTiers,
  validateServiceEconomics,
} from "./economics";

describe("service tier compatibility", () => {
  test("reads current and legacy JSON while ignoring malformed rows", () => {
    assert.deepEqual(
      parsePriceTiers(
        JSON.stringify([
          { min_quantity: "3", unit_price: "9,5" },
          { min_qty: 2, price_per_unit: 12 },
          { min_qty: 1, price_per_unit: 1 },
          { min_qty: 4, price_per_unit: -1 },
          null,
        ]),
      ),
      [
        { min_qty: 2, price_per_unit: 12 },
        { min_qty: 3, price_per_unit: 9.5 },
      ],
    );
    assert.deepEqual(
      parseDurationTiers([
        { threshold: 5, total_duration: 120 },
        { min_qty: 3, total_duration_minutes: "90" },
        { min_qty: 3, duration_minutes: 80 },
        { min_qty: 4, duration_minutes: 12.5 },
      ]),
      [
        { min_qty: 3, duration_minutes: 80 },
        { min_qty: 5, duration_minutes: 120 },
      ],
    );
    assert.deepEqual(parsePriceTiers("not-json"), []);
    assert.deepEqual(parseDurationTiers({ broken: true }), []);
  });

  test("migrates a valid legacy bulk pair into the editor", () => {
    const draft = economicsDraftFromService({
      bulk_threshold: 4,
      bulk_price: 25,
      price_tiers: null,
      duration_tiers: null,
      cost_per_unit: "3,5",
      is_countable: true,
    });
    assert.equal(draft.costPerUnit, "3.5");
    assert.deepEqual(
      draft.tiers.map(({ minQuantity, pricePerUnit, totalDuration }) => ({
        minQuantity,
        pricePerUnit,
        totalDuration,
      })),
      [{ minQuantity: "4", pricePerUnit: "25", totalDuration: "" }],
    );
  });
});

describe("service economics validation", () => {
  test("rejects duplicate thresholds, negative values, and empty tiers", () => {
    const result = validateServiceEconomics({
      costPerUnit: "-2",
      isCountable: true,
      tiers: [
        {
          id: "a",
          minQuantity: "1",
          pricePerUnit: "-3",
          totalDuration: "12.5",
        },
        {
          id: "b",
          minQuantity: "3",
          pricePerUnit: "",
          totalDuration: "",
        },
        {
          id: "c",
          minQuantity: "3",
          pricePerUnit: "8",
          totalDuration: "90",
        },
      ],
    });

    assert.equal(result.value, null);
    assert.ok(result.errors.costPerUnit);
    assert.ok(result.errors.tiers.a?.minQuantity);
    assert.ok(result.errors.tiers.a?.pricePerUnit);
    assert.ok(result.errors.tiers.a?.totalDuration);
    assert.ok(result.errors.tiers.b?.row);
    assert.equal(result.errors.tiers.b?.minQuantity, "Такой порог уже есть");
    assert.equal(result.errors.tiers.c?.minQuantity, "Такой порог уже есть");
  });

  test("sorts tiers and keeps independent price and duration ladders", () => {
    const result = validateServiceEconomics({
      costPerUnit: "4,25",
      isCountable: true,
      tiers: [
        {
          id: "five",
          minQuantity: "5",
          pricePerUnit: "7.5",
          totalDuration: "",
        },
        {
          id: "three",
          minQuantity: "3",
          pricePerUnit: "",
          totalDuration: "90",
        },
      ],
    });

    assert.deepEqual(result.value, {
      cost_per_unit: 4.25,
      is_countable: true,
      price_tiers: [{ min_qty: 5, price_per_unit: 7.5 }],
      duration_tiers: [{ min_qty: 3, duration_minutes: 90 }],
      bulk_threshold: 5,
      bulk_price: 7.5,
    });
  });
});
