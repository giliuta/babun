import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  upcomingRecords,
  changePct,
  previousPeriod,
  serviceProfit,
  accountBreakdown,
  cancelledCount,
  weekdayLoad,
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

  test("сегодняшняя — сделана, когда её время кончилось или её отметили", () => {
    const today = appt({ status: "scheduled", date: "2026-09-24", time_start: "18:00", time_end: "19:00" });
    assert.equal(isPerformed(today, "2026-09-24", "12:00"), false);
    assert.equal(isPerformed(today, "2026-09-24", "19:00"), true);
    assert.equal(isPerformed(today, "2026-09-24"), false);
    assert.equal(isPerformed({ ...today, status: "in_progress" }, "2026-09-24", "12:00"), true);
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

describe("по счетам, по дням недели, отмены", () => {
  test("доход по счетам — со знаком возврата, расход — суммой", () => {
    const rows = accountBreakdown(
      [
        tx({ id: "1", type: "income", amount: 100, account_id: "cash" }),
        tx({ id: "2", type: "refund", amount: -30, account_id: "cash" }),
        tx({ id: "3", type: "income", amount: 50, account_id: "card" }),
        tx({ id: "4", type: "expense", amount: 20, account_id: "card" }),
      ],
      "income",
      [
        { id: "cash", name: "Наличные" },
        { id: "card", name: "Карта" },
      ],
    );
    assert.deepEqual(rows.map((r) => [r.name, r.amount, r.count]), [
      ["Наличные", 70, 2],
      ["Карта", 50, 1],
    ]);
    const exp = accountBreakdown([tx({ id: "4", type: "expense", amount: 20, account_id: "gone" })], "expense", []);
    assert.deepEqual(exp.map((r) => [r.name, r.amount]), [["Счёт закрыт", 20]]);
  });

  test("дни недели — с понедельника, пустые тоже", () => {
    const rows = weekdayLoad([
      appt({ id: "1", date: "2026-09-21" }), // понедельник
      appt({ id: "2", date: "2026-09-27", time_start: "10:00", time_end: "11:30" }), // воскресенье
    ]);
    assert.equal(rows.length, 7);
    assert.equal(rows[0].records, 1);
    assert.equal(rows[6].records, 1);
    assert.equal(rows[6].minutes, 90);
    assert.equal(rows[2].records, 0);
  });

  test("отменённые — только рабочие и в срезе", () => {
    const n = cancelledCount(
      [
        appt({ id: "1", status: "cancelled" }),
        appt({ id: "2", status: "cancelled", kind: "event" }),
        appt({ id: "3", status: "cancelled", date: "2026-08-01" }),
        appt({ id: "4" }),
      ],
      SEP,
    );
    assert.equal(n, 1);
  });
});

describe("таблица по месяцам через новый год", () => {
  test("период 2025→2026 — месяцы обоих лет, итог сходится", () => {
    const t = monthTable(
      { from: 2025, to: 2026 },
      [
        tx({ id: "a", type: "income", amount: 100, occurred_on: "2025-12-28" }),
        tx({ id: "b", type: "income", amount: 50, occurred_on: "2026-01-05" }),
      ],
      [],
      [],
      { today: "2026-01-10", teamId: null },
    );
    assert.equal(t.rows.length, 13);
    assert.equal(t.total.income, 150);
    assert.equal(t.total.key, "2025–2026");
  });
});

describe("сравнение с прошлым периодом", () => {
  test("идущий месяц — те же дни прошлого", () => {
    assert.deepEqual(previousPeriod("2026-09-01", "2026-09-30", "2026-09-24"), {
      from: "2026-08-01",
      to: "2026-08-24",
      partial: true,
    });
  });
  test("законченный месяц — весь прошлый; 31-е прижимается к концу короткого", () => {
    assert.deepEqual(previousPeriod("2026-08-01", "2026-08-31", "2026-09-24"), {
      from: "2026-07-01",
      to: "2026-07-31",
      partial: false,
    });
    assert.deepEqual(previousPeriod("2026-03-01", "2026-03-31", "2026-04-10"), {
      from: "2026-02-01",
      to: "2026-02-28",
      partial: false,
    });
  });
  test("квартал и год — прошлые такие же; через новый год", () => {
    assert.deepEqual(previousPeriod("2026-01-01", "2026-03-31", "2026-05-01").from, "2025-10-01");
    assert.deepEqual(previousPeriod("2025-01-01", "2025-12-31", "2026-05-01"), {
      from: "2024-01-01",
      to: "2024-12-31",
      partial: false,
    });
  });
  test("неделя и свой период — отрезок той же длины перед ним", () => {
    assert.deepEqual(previousPeriod("2026-09-21", "2026-09-27", "2026-09-30"), {
      from: "2026-09-14",
      to: "2026-09-20",
      partial: false,
    });
  });
  test("процент изменения; с нуля сравнивать не с чем", () => {
    assert.equal(changePct(120, 100), 20);
    assert.equal(changePct(50, 100), -50);
    assert.equal(changePct(10, 0), null);
    assert.equal(changePct(-20, -10), -100);
  });
});

describe("прибыль по услугам", () => {
  test("работы минус материалы по количеству", () => {
    const records = [appt({ id: "1", services: [line("c", 3, 50)] as never })];
    const rows = serviceProfit(
      [{ id: "c", name: "Чистка", quantity: 3, records: 1, amount: 150 }],
      records,
      [{ id: "c", name: "Чистка", materials: [{ name: "Химия", cost: 10 }] } as never],
    );
    assert.equal(rows[0].amount, 150);
    assert.ok(rows[0].materials >= 0);
    assert.equal(rows[0].profit, 150 - rows[0].materials);
  });
});

describe("прогноз: записи впереди", () => {
  test("будущие и сегодняшние несделанные — впереди; сделанные и отменённые — нет", () => {
    const s = { ...SEP, nowHm: "12:00" };
    const ids = upcomingRecords(
      [
        appt({ id: "past", status: "scheduled", date: "2026-09-20" }),
        appt({ id: "later-today", status: "scheduled", date: "2026-09-24", time_start: "18:00", time_end: "19:00" }),
        appt({ id: "tomorrow", status: "scheduled", date: "2026-09-25" }),
        appt({ id: "cancelled", status: "cancelled", date: "2026-09-26" }),
        appt({ id: "event", status: "scheduled", date: "2026-09-26", kind: "event" }),
        appt({ id: "october", status: "scheduled", date: "2026-10-02" }),
      ],
      s,
    ).map((a) => a.id);
    assert.deepEqual(ids, ["later-today", "tomorrow"]);
  });
});
