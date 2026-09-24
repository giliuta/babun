import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  isPerformed,
  moneyTotals,
  monthTable,
  performedRecords,
  recordMinutes,
  serviceBreakdown,
  teamBreakdown,
  workTotals,
  yearMonths,
} from "./analytics-math";

const line = (id: string, qty: number, price: number, name?: string) => ({
  serviceId: id,
  quantity: qty,
  pricePerUnit: price,
  originalPrice: price,
  totalPrice: qty * price,
  duration: 60,
  ...(name ? { serviceName: name } : {}),
});

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a",
    kind: "work",
    date: "2026-09-10",
    time_start: "10:00",
    time_end: "11:30",
    status: "completed",
    team_id: "yd",
    total_amount: 0,
    prepaid_amount: 0,
    paid_amount: 0,
    payment_status: "unpaid",
    payments: [],
    payment: null,
    expenses: [],
    services: [],
    service_ids: [],
    ...over,
  }) as unknown as Appointment;

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({ id: "t", type: "income", amount: 0, team_id: "yd", occurred_on: "2026-09-10", ...over }) as FinanceTransaction;

const SEP = { from: "2026-09-01", to: "2026-09-30", today: "2026-09-24", teamId: null };

describe("аналитика: что считается сделанной работой", () => {
  test("выполненная или прошедшая — да; будущая, отменённая и событие — нет", () => {
    assert.equal(isPerformed(appt({}), "2026-09-24"), true);
    assert.equal(isPerformed(appt({ status: "scheduled", date: "2026-09-20" }), "2026-09-24"), true);
    assert.equal(isPerformed(appt({ status: "scheduled", date: "2026-09-25" }), "2026-09-24"), false);
    assert.equal(isPerformed(appt({ status: "cancelled" }), "2026-09-24"), false);
    assert.equal(isPerformed(appt({ kind: "event" }), "2026-09-24"), false);
  });

  test("срез по периоду и команде", () => {
    const list = [
      appt({ id: "1" }),
      appt({ id: "2", team_id: "dk" }),
      appt({ id: "3", date: "2026-08-31" }),
    ];
    assert.deepEqual(performedRecords(list, SEP).map((a) => a.id), ["1", "2"]);
    assert.deepEqual(performedRecords(list, { ...SEP, teamId: "dk" }).map((a) => a.id), ["2"]);
  });

  test("минуты записи; кривое время — ноль", () => {
    assert.equal(recordMinutes({ time_start: "10:00", time_end: "11:30" }), 90);
    assert.equal(recordMinutes({ time_start: "23:00", time_end: "01:00" }), 0);
    assert.equal(recordMinutes({ time_start: "", time_end: "11:00" }), 0);
  });
});

describe("градация по услугам", () => {
  test("штуки складываются, записи считаются по разу, крупные сверху", () => {
    const rows = serviceBreakdown(
      [
        appt({ id: "1", services: [line("clean", 3, 45, "A/C Чистка"), line("gas", 1, 60)] as never }),
        appt({ id: "2", services: [line("clean", 2, 50, "A/C Чистка")] as never }),
      ],
      new Map([["gas", "Заправка"]]),
    );
    assert.deepEqual(rows, [
      { id: "clean", name: "A/C Чистка", quantity: 5, records: 2, amount: 235 },
      { id: "gas", name: "Заправка", quantity: 1, records: 1, amount: 60 },
    ]);
  });

  test("удалённая услуга без снимка имени не теряется", () => {
    const rows = serviceBreakdown([appt({ services: [line("x", 1, 10)] as never })], new Map());
    assert.equal(rows[0].name, "Услуга удалена");
  });
});

describe("деньги — правилом плиток «Финансов»", () => {
  test("доход и возврат со знаком, расход, срез команды и периода", () => {
    const t = moneyTotals(
      [
        tx({ id: "1", type: "income", amount: 160 }),
        tx({ id: "2", type: "refund", amount: -35 }),
        tx({ id: "3", type: "expense", amount: 20 }),
        tx({ id: "4", type: "transfer", amount: 55 }),
        tx({ id: "5", type: "income", amount: 999, team_id: "dk" }),
        tx({ id: "6", type: "income", amount: 999, occurred_on: "2026-08-01" }),
      ],
      [],
      [],
      { ...SEP, teamId: "yd" },
    );
    assert.deepEqual(t, { income: 125, expense: 20, profit: 105 });
  });

  test("строка без команды — под командой своего счёта, как на «Финансах»", () => {
    const rows = [
      tx({ id: "1", type: "income", amount: 70, team_id: null, account_id: "rev" }),
      tx({ id: "2", type: "income", amount: 30, team_id: null, account_id: "cash-dk" }),
      tx({ id: "3", type: "income", amount: 5, team_id: null, account_id: null }),
    ];
    const accountTeam = new Map([
      ["rev", "yd"],
      ["cash-dk", "dk"],
    ]);
    assert.equal(moneyTotals(rows, [], [], { ...SEP, teamId: "yd", accountTeam }).income, 70);
    assert.equal(moneyTotals(rows, [], [], { ...SEP, teamId: "dk", accountTeam }).income, 30);
    assert.equal(moneyTotals(rows, [], [], { ...SEP, teamId: null }).income, 105);
  });
});

describe("итоги работы", () => {
  test("работ на, оплачено, средний чек и работ на час", () => {
    const w = workTotals([
      appt({ id: "1", services: [line("c", 3, 45)] as never, prepaid_amount: 100 }),
      appt({ id: "2", services: [line("c", 1, 50)] as never, time_start: "12:00", time_end: "12:30" }),
    ]);
    assert.equal(w.records, 2);
    assert.equal(w.worked, 185);
    assert.equal(w.paid, 100);
    assert.equal(w.averageCheck, 92.5);
    assert.equal(w.minutes, 120);
    assert.equal(w.perHour, 92.5);
  });

  test("без записей — нули, работ на час — нет", () => {
    assert.deepEqual(workTotals([]), {
      records: 0, worked: 0, paid: 0, averageCheck: 0, minutes: 0, perHour: null,
    });
  });
});

describe("помесячная таблица", () => {
  test("месяцы года до текущего; прошлый год — все двенадцать", () => {
    assert.equal(yearMonths(2026, "2026-09-24").length, 9);
    assert.equal(yearMonths(2025, "2026-09-24").length, 12);
    assert.deepEqual(yearMonths(2026, "2026-02-10")[1], {
      key: "2026-02", from: "2026-02-01", to: "2026-02-28",
    });
  });

  test("итог — сумма месяцев", () => {
    const { rows, total } = monthTable(
      2026,
      [
        tx({ id: "1", amount: 100, occurred_on: "2026-08-05" }),
        tx({ id: "2", amount: 50, occurred_on: "2026-09-05" }),
        tx({ id: "3", type: "expense", amount: 30, occurred_on: "2026-09-06" }),
      ],
      [],
      [],
      { today: "2026-09-24", teamId: null },
    );
    assert.equal(rows.find((r) => r.key === "2026-09")?.profit, 20);
    assert.deepEqual(
      { i: total.income, e: total.expense, p: total.profit },
      { i: 150, e: 30, p: 120 },
    );
  });
});

describe("разрез по командам", () => {
  test("команды по сумме работ; без команды — своей строкой", () => {
    const rows = teamBreakdown(
      [
        appt({ id: "1", team_id: "yd", services: [line("c", 1, 50)] as never }),
        appt({ id: "2", team_id: "dk", services: [line("c", 4, 45)] as never }),
        appt({ id: "3", team_id: null, services: [line("c", 1, 10)] as never }),
      ],
      [{ id: "yd", name: "Y&D" }, { id: "dk", name: "D&K" }],
    );
    assert.deepEqual(rows.map((r) => [r.name, r.worked]), [
      ["D&K", 180], ["Y&D", 50], ["Без команды", 10],
    ]);
  });
});
