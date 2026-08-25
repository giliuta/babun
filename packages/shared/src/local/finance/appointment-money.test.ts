import { describe, expect, test } from "bun:test";

import type { AppointmentService } from "../appointments";
import {
  applyDiscount,
  appointmentDebtCents,
  appointmentTotal,
  globalDiscountAmount,
  lineTotal,
  round2,
  subtotal,
} from "./appointment-calc";

// Деньги записи — это сумма, которую называют клиенту и которая уезжает в
// счёт. До этого файла путь скидок не исполнял ни один из 114 тестов:
// `applyDiscount`, `appointmentTotal` и `globalDiscountAmount` были не покрыты
// целиком, а `lineTotal`/`subtotal` — только без скидки, через инвойсы.

const line = (
  overrides: Partial<AppointmentService> & { quantity: number; pricePerUnit: number },
): AppointmentService => ({
  serviceId: "clean",
  originalPrice: overrides.pricePerUnit,
  totalPrice: overrides.quantity * overrides.pricePerUnit,
  duration: 60,
  ...overrides,
});

describe("applyDiscount", () => {
  // ШКАЛА ПРОЦЕНТА — 0…100, а не доля (local/appointments.ts:48 «0–100 for
  // percent»). Этот тест ловит классическую подмену 0.1 вместо 10: она молча
  // уводит итог записи в десять раз мимо и видна только в чеке клиента.
  test("процент задаётся в 0…100: 10% от 100 — это 90, а не 99,9", () => {
    expect(applyDiscount(100, { type: "percent", value: 10 })).toBe(90);
  });

  test("процент 0 — это «скидка 0%», а не «скидки нет»", () => {
    expect(applyDiscount(100, { type: "percent", value: 0 })).toBe(100);
  });

  test("процент больше 100 упирается в ноль, а не уходит в минус", () => {
    expect(applyDiscount(100, { type: "percent", value: 140 })).toBe(0);
  });

  test("фиксированная скидка больше базы даёт ноль", () => {
    expect(applyDiscount(100, { type: "fixed", value: 200 })).toBe(0);
  });

  test("скидки нет — база возвращается как есть", () => {
    expect(applyDiscount(100, null)).toBe(100);
    expect(applyDiscount(100)).toBe(100);
  });
});

describe("lineTotal / subtotal / appointmentTotal", () => {
  test("строка округляется ПОСЛЕ скидки: 3 × 33,33 = 99,99", () => {
    expect(lineTotal(line({ quantity: 3, pricePerUnit: 33.33 }))).toBe(99.99);
  });

  test("строчная скидка 10% на 99,99 — 89,99 (округление, а не 89,991)", () => {
    expect(
      lineTotal(
        line({
          quantity: 3,
          pricePerUnit: 33.33,
          discount: { type: "percent", value: 10 },
        }),
      ),
    ).toBe(89.99);
  });

  // Округляется КАЖДАЯ строка, а потом сумма. Две строки по 0,125: построчно
  // выходит 0,13 + 0,13 = 0,26, а округлением одной только суммы — 0,25.
  test("сумма собирается из уже округлённых строк, а не наоборот", () => {
    expect(
      subtotal([
        line({ quantity: 1, pricePerUnit: 0.125 }),
        line({ quantity: 1, pricePerUnit: 0.125 }),
      ]),
    ).toBe(0.26);
  });

  test("пустая запись стоит ноль", () => {
    expect(appointmentTotal([])).toBe(0);
    expect(subtotal([])).toBe(0);
  });

  test("строчная 10% и глобальная 10% применяются одна за другой", () => {
    // 3 × 33,33 → 99,99 → −10% строкой → 89,99 → −10% глобально → 80,99.
    expect(
      appointmentTotal(
        [
          line({
            quantity: 3,
            pricePerUnit: 33.33,
            discount: { type: "percent", value: 10 },
          }),
        ],
        { type: "percent", value: 10 },
      ),
    ).toBe(80.99);
  });

  test("глобальная скидка не уводит итог в минус", () => {
    expect(
      appointmentTotal([line({ quantity: 1, pricePerUnit: 50 })], {
        type: "fixed",
        value: 80,
      }),
    ).toBe(0);
  });
});

describe("globalDiscountAmount", () => {
  test("скидки нет — печатать нечего", () => {
    expect(globalDiscountAmount([line({ quantity: 1, pricePerUnit: 50 })], null)).toBe(0);
  });

  test("показанная скидка равна разнице подытога и итога", () => {
    const services = [line({ quantity: 3, pricePerUnit: 33.33 })];
    const discount = { type: "percent" as const, value: 10 };
    expect(globalDiscountAmount(services, discount)).toBe(10);
    expect(round2(subtotal(services) - appointmentTotal(services, discount))).toBe(10);
  });

  test("скидка не больше самого подытога", () => {
    expect(
      globalDiscountAmount([line({ quantity: 1, pricePerUnit: 50 })], {
        type: "fixed",
        value: 80,
      }),
    ).toBe(50);
  });
});

describe("round2", () => {
  test("снимает двоичный хвост: 10 − 1,12 = 8,88", () => {
    expect(round2(10 - 1.12)).toBe(8.88);
  });
});

// Блокер 2026-08-25: долг записи считался вычитанием float'ов, а поле оплаты
// предзаполнялось долгом, округлённым до копеек. Собственная подстановка «вся
// сумма» оказывалась больше долга — принятую оплату нельзя было сохранить.
describe("appointmentDebtCents", () => {
  test("остаток после аванса — ровные центы, а не 8,879999…", () => {
    expect(appointmentDebtCents(10, 1.12)).toBe(888);
  });

  test("предзаполнение «вся сумма» проходит собственный гейт формы", () => {
    const debtCents = appointmentDebtCents(10, 1.12);
    // Ровно то, что делает шит: печатает долг в поле и сравнивает обратно.
    const prefilled = Math.round(Math.max(0, debtCents / 100) * 100) / 100;
    expect(Math.round(prefilled * 100)).toBeLessThanOrEqual(debtCents);
  });

  test("оплата ровно остатка закрывает долг в ноль", () => {
    expect(appointmentDebtCents(10, 1.12 + 8.88)).toBe(0);
  });

  test("«Возвращено» — долга нет, каким бы ни был итог", () => {
    expect(appointmentDebtCents(120, 0, "refunded")).toBe(0);
  });

  test("переплата — ноль, а не отрицательный долг", () => {
    expect(appointmentDebtCents(50, 80)).toBe(0);
  });

  test("новая запись без платежей должна всю сумму", () => {
    expect(appointmentDebtCents(99.99, 0, "unpaid")).toBe(9999);
  });

  test("нечисловой вход не заражает деньги NaN'ом", () => {
    expect(appointmentDebtCents(Number.NaN, 10)).toBe(0);
    expect(appointmentDebtCents(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
