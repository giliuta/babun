import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { dayMoney, isMoneyRecord, moneyByAccount, moneyOfDay } from "./day-money";

// ДЕНЬГИ ЗАПИСИ — В ДНЕ ЗАПИСИ (владелец 2026-10-01). Живой случай: предоплата
// €20 внесена 30.09 за запись на 1.10 — полоса показывала её в среду, где
// записи нет. Операция без записи (доход/расход с категорией) — в своём дне.

const TODAY = "2026-09-30";
const TOMORROW = "2026-10-01";

const tx = (
  over: Partial<FinanceTransaction> & Pick<FinanceTransaction, "id" | "type" | "amount">,
): FinanceTransaction =>
  ({
    source: "manual",
    occurred_on: TODAY,
    occurred_time: null,
    appointment_id: null,
    account_id: "cash",
    refund_of_id: null,
    notes: null,
    team_id: "t1",
    ...over,
  }) as FinanceTransaction;

const appt = (over: Partial<Appointment> & Pick<Appointment, "id">): Appointment =>
  ({
    date: TOMORROW,
    time_start: "13:30",
    time_end: "16:00",
    kind: "work",
    status: "scheduled",
    payment_status: "unpaid",
    total_amount: 50,
    prepaid_amount: 0,
    payments: [],
    payment: null,
    paid_amount: 0,
    services: [],
    expenses: [],
    team_id: "t1",
    ...over,
  }) as unknown as Appointment;

const run = (
  ymd: string,
  appointments: Appointment[],
  transactions: FinanceTransaction[],
  nowHm = "11:35",
) =>
  dayMoney({
    ymd,
    appointments,
    transactions,
    services: [],
    teamId: "t1",
    businessToday: TODAY,
    nowHm,
  });

describe("доход дня — деньги записи в дне записи", () => {
  const record = appt({ id: "a1", prepaid_amount: 20 });
  const prepay = tx({
    id: "p1",
    type: "income",
    amount: 20,
    source: "auto",
    appointment_id: "a1",
    occurred_on: TODAY,
  });

  test("предоплата сегодня за завтра — доход завтра, в дне записи", () => {
    const today = run(TODAY, [record], [prepay]);
    assert.equal(today.income, 0);
    assert.equal(today.incomeRows.length, 0);

    const tomorrow = run(TOMORROW, [record], [prepay]);
    assert.equal(tomorrow.income, 20);
    assert.deepEqual(tomorrow.incomeRows.map((r) => r.id), ["p1"]);
  });

  test("перенесли запись — деньги переехали вместе с ней", () => {
    const moved = { ...record, date: "2026-10-02" } as Appointment;
    assert.equal(run(TOMORROW, [moved], [prepay]).income, 0);
    assert.equal(run("2026-10-02", [moved], [prepay]).income, 20);
  });

  test("запись не в этом дне — её денег здесь нет, даже внесённых сегодня", () => {
    // Запись в другой неделе: её нет среди записей экрана.
    assert.equal(run(TODAY, [], [prepay]).income, 0);
  });

  test("операция без записи — в своём дне", () => {
    const manual = tx({ id: "m1", type: "income", amount: 70, occurred_on: TODAY });
    const fuel = tx({ id: "e1", type: "expense", amount: -15, occurred_on: TODAY });
    const today = run(TODAY, [record], [manual, fuel, prepay]);
    assert.equal(today.income, 70);
    assert.equal(today.expense, 15);
    assert.equal(run(TOMORROW, [record], [manual, fuel, prepay]).income, 20);
  });

  test("строка из двух выборок (журнал дней и операции записей) — один раз", () => {
    assert.equal(run(TOMORROW, [record], [prepay, prepay]).income, 20);
    assert.deepEqual(
      moneyOfDay(TOMORROW, [record], [prepay, prepay]).map((r) => r.id),
      ["p1"],
    );
  });

  test("отменённая запись с предоплатой — деньги в её дне, не в дне внесения", () => {
    const cancelled = { ...record, status: "cancelled" } as Appointment;
    assert.equal(run(TOMORROW, [cancelled], [prepay]).income, 20);
    assert.equal(run(TODAY, [cancelled], [prepay]).income, 0);
  });

  test("«Ожидается» — остаток, а не вся сумма записи", () => {
    const tomorrow = run(TOMORROW, [record], [prepay]);
    assert.equal(tomorrow.planned, 30);
    assert.deepEqual(tomorrow.plannedRecords.map((a) => a.id), ["a1"]);
    assert.equal(tomorrow.debt, 0);
  });

  test("плитка — ровно сумма своего списка; полный откат прячется парой", () => {
    const rows = [
      tx({ id: "i1", type: "income", amount: 50 }),
      tx({ id: "r1", type: "refund", amount: -50, refund_of_id: "i1" }),
      tx({ id: "i2", type: "income", amount: 30 }),
      tx({ id: "r2", type: "refund", amount: -10, refund_of_id: "i2" }),
      tx({ id: "t1", type: "transfer", amount: 100 }),
      tx({ id: "old", type: "income", amount: 999, occurred_on: "2026-09-29" }),
    ];
    const day = run(TODAY, [], rows);
    assert.deepEqual(day.incomeRows.map((r) => r.id), ["i2", "r2"]);
    assert.equal(day.income, 20);
  });
});

describe("события и отменённые — не деньги", () => {
  test("личное событие не попадает ни в план, ни в долг, ни в ожидание", () => {
    const event = appt({ id: "e1", kind: "event", total_amount: 0, time_start: "17:00" });
    const day = run(TOMORROW, [appt({ id: "a1" }), event], []);
    assert.deepEqual(day.records.map((a) => a.id), ["a1"]);
    assert.equal(isMoneyRecord(event), false);
  });

  test("отменённая запись — вне плана и долга", () => {
    const day = run(
      "2026-09-29",
      [appt({ id: "c1", date: "2026-09-29", status: "cancelled" })],
      [],
    );
    assert.equal(day.records.length, 0);
    assert.equal(day.debt, 0);
  });
});

describe("долг и ожидание", () => {
  test("время прошло — долг, ещё идёт — ожидается", () => {
    const past = appt({ id: "p", date: TODAY, time_start: "09:00", time_end: "10:00" });
    const later = appt({ id: "l", date: TODAY, time_start: "15:00", time_end: "16:00" });
    const day = run(TODAY, [past, later], [], "11:35");
    assert.deepEqual(day.debtRecords.map((a) => a.id), ["p"]);
    assert.equal(day.debt, 50);
    assert.deepEqual(day.plannedRecords.map((a) => a.id), ["l"]);
    assert.equal(day.planned, 50);
  });

  test("оплаченная запись не ждёт и не должна", () => {
    const paid = appt({ id: "x", date: TODAY, prepaid_amount: 50, payment_status: "paid" });
    const day = run(TODAY, [paid], []);
    assert.equal(day.planned, 0);
    assert.equal(day.debt, 0);
  });
});

describe("расход дня", () => {
  test("расходы леджера за день, без переводов и чужих дней", () => {
    const day = run(TODAY, [], [
      tx({ id: "e1", type: "expense", amount: 12.5 }),
      tx({ id: "e2", type: "expense", amount: 7.5, occurred_on: "2026-09-29" }),
      tx({ id: "t1", type: "transfer", amount: -40 }),
    ]);
    assert.equal(day.expense, 12.5);
    assert.deepEqual(day.expenseRows.map((r) => r.id), ["e1"]);
    assert.equal(day.profit, -12.5);
  });
});

describe("по счетам", () => {
  test("порядок страницы «Счета», ноль остаётся, чужой и «без счёта» — в конце", () => {
    const rows = [
      tx({ id: "1", type: "income", amount: 20, account_id: "card" }),
      tx({ id: "2", type: "income", amount: 30, account_id: "cash" }),
      tx({ id: "3", type: "refund", amount: -5, account_id: "cash" }),
      tx({ id: "4", type: "income", amount: 7, account_id: "closed" }),
      tx({ id: "5", type: "income", amount: 3, account_id: null }),
    ];
    const split = moneyByAccount(rows, ["cash", "card", "bank"]);
    assert.deepEqual(
      split.map((s) => [s.accountId, s.amount, s.count]),
      [
        ["cash", 25, 2],
        ["card", 20, 1],
        ["bank", 0, 0],
        ["closed", 7, 1],
        [null, 3, 1],
      ],
    );
  });

  test("расход — положительной суммой; материалы в разбивку не идут", () => {
    const rows = [
      tx({ id: "e1", type: "expense", amount: 12, account_id: "cash" }),
      tx({ id: "material:a1", type: "expense", amount: 5, source: "auto", account_id: null }),
    ];
    const split = moneyByAccount(rows, ["cash"]);
    assert.deepEqual(split.map((s) => [s.accountId, s.amount]), [["cash", 12]]);
  });

  test("сумма по счетам = плитка «Доход» (без материалов)", () => {
    const rows = [
      tx({ id: "1", type: "income", amount: 20, account_id: "card" }),
      tx({ id: "2", type: "income", amount: 30, account_id: "cash" }),
    ];
    const day = run(TODAY, [], rows);
    const split = moneyByAccount(day.incomeRows, ["cash", "card"]);
    assert.equal(split.reduce((s, e) => s + e.amount, 0), day.income);
  });
});
