import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  dayDebtRecords,
  dayDebtTotal,
  isPastRecord,
  ledgerExtrasByDay,
  ledgerExtrasForDay,
} from "./day-ledger";

const tx = (over: Partial<FinanceTransaction> & { id: string; type: FinanceTransaction["type"]; amount: number }): FinanceTransaction =>
  ({
    source: "manual",
    occurred_on: "2026-09-06",
    notes: null,
    ...over,
  }) as FinanceTransaction;

describe("ledgerExtrasForDay", () => {
  test("ручные доход и расход дня становятся «ручными операциями»; авто и переводы — нет", () => {
    const extras = ledgerExtrasForDay(
      [
        tx({ id: "tip", type: "income", amount: 20, notes: "Чаевые" }),
        tx({ id: "fuel", type: "expense", amount: 35, notes: "Заправка" }),
        tx({ id: "auto", type: "income", amount: 100, source: "auto" }),
        tx({ id: "move", type: "transfer", amount: -50 }),
        tx({ id: "other-day", type: "expense", amount: 5, occurred_on: "2026-09-07" }),
      ],
      "2026-09-06",
    );
    assert.deepEqual(
      extras.map((e) => [e.kind, e.name, e.amount]),
      [
        ["income", "Чаевые", 20],
        ["expense", "Заправка", 35],
      ],
    );
  });

  test("ручной возврат — отрицательный доход, без заметки — имя по виду", () => {
    const [refund, plain] = ledgerExtrasForDay(
      [
        tx({ id: "r", type: "refund", amount: -15 }),
        tx({ id: "e", type: "expense", amount: 7, notes: "  " }),
      ],
      "2026-09-06",
    );
    assert.equal(refund.kind, "income");
    assert.equal(refund.amount, -15);
    assert.equal(plain.name, "Расход");
  });

  test("по дням: только дни с ручными проводками", () => {
    const byDay = ledgerExtrasByDay([
      tx({ id: "a", type: "income", amount: 1, occurred_on: "2026-09-01" }),
      tx({ id: "b", type: "income", amount: 2, occurred_on: "2026-09-02", source: "auto" }),
    ]);
    assert.deepEqual([...byDay.keys()], ["2026-09-01"]);
  });
});

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a",
    date: "2026-09-08",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    total_amount: 100,
    prepaid_amount: 0,
    payments: [],
    ...over,
  }) as unknown as Appointment;

describe("долг дня", () => {
  test("время прошло и не оплачено — долг; будущее и текущее — план", () => {
    const today = "2026-09-08";
    assert.equal(isPastRecord(appt({}), today, "12:00"), true);
    assert.equal(isPastRecord(appt({}), today, "10:30"), false);
    assert.equal(isPastRecord(appt({ date: "2026-09-09" }), today, "23:00"), false);
    assert.equal(isPastRecord(appt({ date: "2026-09-07" }), today, "00:00"), true);
    assert.equal(isPastRecord(appt({ status: "completed", date: "2026-09-09" }), today, "00:00"), true);
  });

  test("список и сумма долга дня: без отменённых и оплаченных", () => {
    const rows = [
      appt({ id: "unpaid" }),
      appt({
        id: "paid",
        payments: [{ id: "p1", method: "cash", paid_at: "2026-09-08T11:00:00Z", amount: 100 }],
      }),
      appt({ id: "cancelled", status: "cancelled" }),
      appt({ id: "later", time_start: "15:00", time_end: "16:00" }),
    ];
    const debt = dayDebtRecords(rows, "2026-09-08", "12:00");
    assert.deepEqual(debt.map((a) => a.id), ["unpaid"]);
    assert.equal(dayDebtTotal(rows, "2026-09-08", "12:00"), 100);
    assert.equal(dayDebtTotal(rows, "2026-09-08", "17:00"), 200);
  });
});

