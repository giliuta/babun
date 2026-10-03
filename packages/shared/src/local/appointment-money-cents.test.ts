import { describe, expect, test } from "bun:test";
import { getDebtAmount, getPaidAmount } from "./appointments";
import type { Appointment } from "./appointments";

// ДОЛГ И ОПЛАЧЕНО — ДО ЦЕНТА (проверка системы 03.10). Во float аванс 4,76 +
// платёж 7,14 = 11.899999…, и у полностью оплаченной записи появлялся долг
// 1.8e-15: строка «€0» в «Долгах», в долгах дня и у клиента.

const apt = (over: Partial<Appointment>): Appointment =>
  ({
    payment_status: "paid",
    payments: [],
    payment: null,
    paid_amount: 0,
    prepaid_amount: 0,
    total_amount: 0,
    ...over,
  }) as Appointment;

describe("деньги записи до цента", () => {
  test("аванс + платёж ровно закрывают итог — долга нет", () => {
    const a = apt({ prepaid_amount: 4.76, payments: [{ amount: 7.14 }] as Appointment["payments"], total_amount: 11.9 });
    expect(getPaidAmount(a)).toBe(11.9);
    expect(getDebtAmount(a)).toBe(0);
  });

  test("перебор разбиений с копейками: долг всегда целое число центов", () => {
    for (let total = 1000; total <= 1300; total += 7) {
      for (let pre = 1; pre < total; pre += 37) {
        const a = apt({
          prepaid_amount: pre / 100,
          payments: [{ amount: (total - pre) / 100 }] as Appointment["payments"],
          total_amount: total / 100,
        });
        expect(getDebtAmount(a)).toBe(0);
      }
    }
  });

  test("частичная оплата — остаток в центах", () => {
    const a = apt({ payment_status: "partial", prepaid_amount: 3.17, payments: [{ amount: 2.2 }] as Appointment["payments"], total_amount: 10.56 });
    expect(getDebtAmount(a)).toBe(5.19);
  });
});
