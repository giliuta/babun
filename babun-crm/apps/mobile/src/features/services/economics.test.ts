import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  displayValue,
  draftValue,
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
    });
    assert.deepEqual(
      draft.tiers.map(({ minQuantity, rowPrice, totalDuration }) => ({
        minQuantity,
        rowPrice,
        totalDuration,
      })),
      // ЗА ВСЁ, А НЕ ЗА ШТУКУ: 25 за единицу при пороге 4 человек видит как
      // «100» — то же число, названное так, как он его диктует.
      [{ minQuantity: "4", rowPrice: "100", totalDuration: "" }],
    );
  });
});

describe("сумма за строку ходит туда и обратно без потерь", () => {
  test("«100 за три» возвращается ровно сотней, а не 99,99", () => {
    // Круг, ради которого вся правка и затевалась (владелец 2026-08-21:
    // «3 комнаты стоит 100 — это им надо вписать 33.33, неудобно»).
    const typed = {
      tiers: [
        {
          id: "three",
          minQuantity: "3",
          rowPrice: "100",
          rowCost: "0",
          totalDuration: "",
        },
      ],
    };
    const saved = validateServiceEconomics(typed).value;
    assert.ok(saved);
    // В базу уехало за одну — с полным хвостом, без округления до копеек:
    // округли здесь, и обратный путь дал бы 99,99.
    assert.equal(saved.price_tiers?.[0]?.min_qty, 3);
    assert.ok(Math.abs((saved.price_tiers?.[0]?.price_per_unit ?? 0) - 100 / 3) < 1e-12);

    const reopened = economicsDraftFromService({
      price_tiers: saved.price_tiers,
      duration_tiers: null,
    });
    assert.equal(reopened.tiers[0]?.rowPrice, "100");
  });

  test("правка количества не двигает напечатанную сумму", () => {
    // Человек вписал «100 за три» и передумал: пусть будет за четыре. Сумма,
    // на которую он смотрит, обязана остаться сотней — меняется цена за штуку,
    // а не число на экране.
    const afterQtyEdit = {
      tiers: [
        {
          id: "row",
          minQuantity: "4",
          rowPrice: "100",
          rowCost: "0",
          totalDuration: "",
        },
      ],
    };
    const saved = validateServiceEconomics(afterQtyEdit).value;
    assert.equal(saved?.price_tiers?.[0]?.price_per_unit, 25);
  });
});

describe("service economics validation", () => {
  test("rejects duplicate thresholds, negative values, and empty tiers", () => {
    const result = validateServiceEconomics({
      tiers: [
        {
          id: "a",
          minQuantity: "1",
          rowPrice: "-3",
          rowCost: "0",
          totalDuration: "12.5",
        },
        {
          id: "b",
          minQuantity: "3",
          rowPrice: "",
          rowCost: "0",
          totalDuration: "",
        },
        {
          id: "c",
          minQuantity: "3",
          rowPrice: "8",
          rowCost: "0",
          totalDuration: "90",
        },
      ],
    });

    assert.equal(result.value, null);
    assert.ok(result.errors.tiers.a?.minQuantity);
    assert.ok(result.errors.tiers.a?.rowPrice);
    assert.ok(result.errors.tiers.a?.totalDuration);
    assert.ok(result.errors.tiers.b?.row);
    assert.equal(result.errors.tiers.b?.minQuantity, "Такое количество уже есть");
    assert.equal(result.errors.tiers.c?.minQuantity, "Такое количество уже есть");
  });

  test("sorts tiers and keeps independent price and duration ladders", () => {
    const result = validateServiceEconomics({
      tiers: [
        {
          id: "five",
          minQuantity: "5",
          rowPrice: "40",
          rowCost: "0",
          totalDuration: "",
        },
        {
          id: "three",
          minQuantity: "3",
          rowPrice: "",
          rowCost: "0",
          totalDuration: "90",
        },
      ],
    });

    // ЗЕРКАЛО ОПТА — ЯВНЫЙ НОЛЬ, а не копия первой цены: иначе убранная
    // лестница воскресала из легаси-ветки `rowPrice` при частичном патче.
    assert.deepEqual(result.value, {
      // В базу уезжает ЗА ОДНУ: 40 за пять — это 8 за штуку. Форма хранения
      // не менялась, поменялся только язык, которым спрашивают человека.
      price_tiers: [{ min_qty: 5, price_per_unit: 8 }],
      duration_tiers: [{ min_qty: 3, duration_minutes: 90 }],
      cost_tiers: [],
      bulk_threshold: 0,
      bulk_price: 0,
    });
  });
});

describe("линза «за всё ↔ за одну»", () => {
  test("показ делит сумму строки на количество", () => {
    assert.equal(displayValue("135", 3, "unit"), "45");
    assert.equal(displayValue("135", 3, "total"), "135");
  });

  test("первая строка не делится ни в каком режиме", () => {
    assert.equal(displayValue("50", 1, "unit"), "50");
  });

  test("ТУДА И ОБРАТНО БЕЗ ПОТЕРИ КОПЕЙКИ — главное свойство линзы", () => {
    // 100 за три показывается как 33,33; пока человек не напечатал своё,
    // черновик держит точную сотню, и обратно выходит именно она.
    const shown = displayValue("100", 3, "unit");
    assert.equal(shown, "33.33");
    assert.equal(draftValue(shown, 3, "unit"), "99.99");
    // Но черновик не трогали — значит в базу уедет исходное число.
    assert.equal(displayValue("100", 3, "total"), "100");
  });

  test("набранное в режиме «за одну» умножается на количество", () => {
    assert.equal(draftValue("45", 3, "unit"), "135");
    assert.equal(draftValue("45", 3, "total"), "45");
  });

  test("пустое остаётся пустым: пусто — это не ноль", () => {
    assert.equal(displayValue("", 3, "unit"), "");
    assert.equal(draftValue("", 3, "unit"), "");
  });
});

