import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { countOverdue, endMinutesOf, isOverdue } from "./overdue";

const apt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    date: "2026-09-05",
    time_start: "09:00",
    time_end: "10:00",
    status: "scheduled",
    kind: "work",
    total_amount: 100,
    prepaid_amount: 0,
    payments: [],
    payment_status: "unpaid",
    ...over,
  }) as Appointment;

const TODAY = "2026-09-06";

describe("isOverdue", () => {
  test("прошлый день, запланирована, работа — просрочена", () => {
    assert.equal(isOverdue(apt({}), TODAY, 700), true);
  });

  test("закрытая, отменённая и начатая не просрочены", () => {
    for (const status of ["completed", "cancelled", "in_progress"] as const) {
      assert.equal(isOverdue(apt({ status }), TODAY, 700), false, status);
    }
  });

  test("событие в прошлом не просрочено: закрывать нечего", () => {
    assert.equal(isOverdue(apt({ kind: "event" }), TODAY, 700), false);
    assert.equal(isOverdue(apt({ kind: "personal" }), TODAY, 700), false);
  });

  test("сегодня — по концу записи против текущей минуты", () => {
    const today = apt({ date: TODAY, time_start: "09:00", time_end: "10:00" });
    assert.equal(isOverdue(today, TODAY, 11 * 60), true);
    assert.equal(isOverdue(today, TODAY, 9 * 60 + 30), false);
  });

  test("про сегодня не знаем — не просрочена", () => {
    assert.equal(isOverdue(apt({ date: TODAY }), TODAY, null), false);
    assert.equal(isOverdue(apt({ date: TODAY }), TODAY, undefined), false);
  });

  test("завтра не просрочена, и без «сегодня» правило молчит", () => {
    assert.equal(isOverdue(apt({ date: "2026-09-07" }), TODAY, 700), false);
    assert.equal(isOverdue(apt({}), null, 700), false);
    assert.equal(isOverdue(apt({}), "", 700), false);
  });

  test("нулевая запись живёт те же 15 минут, что и в раскладке", () => {
    // Иначе счётчик и сетка разойдутся на записи, которую сетка ещё рисует.
    const zero = apt({ date: TODAY, time_start: "09:00", time_end: "09:00" });
    assert.equal(endMinutesOf(zero), 9 * 60 + 15);
    assert.equal(isOverdue(zero, TODAY, 9 * 60 + 10), false);
    assert.equal(isOverdue(zero, TODAY, 9 * 60 + 20), true);
  });
});

describe("isOverdue — деньги", () => {
  test("оплаченная вперёд целиком прошлая запись не просрочена", () => {
    const prepaid = apt({ total_amount: 300, prepaid_amount: 300, payment_status: "paid" });
    assert.equal(isOverdue(prepaid, TODAY, 700), false);
  });

  test("статус «оплачено» закрывает долг, как в цвете записи", () => {
    assert.equal(isOverdue(apt({ payment_status: "paid" }), TODAY, 700), false);
  });

  test("запись с суммой 0 не просрочена: получать нечего", () => {
    assert.equal(isOverdue(apt({ total_amount: 0 }), TODAY, 700), false);
  });

  test("частичный аванс — долг есть, запись просрочена", () => {
    const partial = apt({ total_amount: 300, prepaid_amount: 100 });
    assert.equal(isOverdue(partial, TODAY, 700), true);
  });
});

describe("countOverdue", () => {
  test("считает только незакрытые работы прошлого", () => {
    const list = [
      apt({ id: "1" }),
      apt({ id: "2", status: "completed" }),
      apt({ id: "3" }),
      apt({ id: "4", date: "2026-09-07" }),
    ];
    assert.equal(countOverdue(list, TODAY, null), 2);
    assert.equal(countOverdue([], TODAY, null), 0);
  });
});
