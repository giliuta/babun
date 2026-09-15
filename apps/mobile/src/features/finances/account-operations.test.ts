import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { accountOperationRows } from "./account-operations";
import {
  dropAccountNames,
  whatLine,
  type RecordRow,
  type RecordRowRefs,
} from "./record-rows";

const CASH = "acc-cash";
const CARD = "acc-card";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-12",
    time_start: "10:30",
    time_end: "11:30",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", serviceName: "A/C Cleaning" }],
    ...over,
  }) as unknown as Appointment;

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx",
    type: "income",
    amount: 50,
    account_id: CASH,
    appointment_id: null,
    refund_of_id: null,
    transfer_group_id: null,
    category_id: null,
    notes: null,
    occurred_on: "2026-09-12",
    occurred_time: null,
    ...over,
  }) as unknown as FinanceTransaction;

const REFS: RecordRowRefs = {
  appointments: [
    appt({ id: "a-paid" }),
    appt({ id: "a-undone", client_id: "c2", time_start: "12:00" }),
  ],
  clients: [
    { id: "c1", full_name: "Андрей" },
    { id: "c2", full_name: "Nikita" },
  ],
  services: [{ id: "s1", name: "A/C Cleaning" }],
  categories: [{ id: "cat-goods", name: "Товары" }],
  accounts: [
    { id: CASH, name: "Наличные" },
    { id: CARD, name: "Карта" },
  ],
};

// Команда Y&D в миниатюре: визит Андрея оплачен наличными и картой, оплата
// Nikita снята целиком, ручной доход «Товары», бензин, перевод с наличных на
// карту.
const LEDGER = [
  tx({ id: "pay", amount: 160, appointment_id: "a-paid" }),
  tx({ id: "card-pay", amount: 35, account_id: CARD, appointment_id: "a-paid" }),
  tx({ id: "undo-pay", amount: 195, appointment_id: "a-undone" }),
  tx({
    id: "undo",
    type: "refund",
    amount: -195,
    appointment_id: "a-undone",
    refund_of_id: "undo-pay",
  }),
  tx({ id: "goods", amount: 50, category_id: "cat-goods" }),
  tx({ id: "petrol", type: "expense", amount: 20, notes: "бензин" }),
  tx({ id: "out", type: "transfer", amount: -55, transfer_group_id: "g1" }),
  tx({
    id: "in",
    type: "transfer",
    amount: 55,
    transfer_group_id: "g1",
    account_id: CARD,
  }),
];

const rowsFor = (...ids: string[]) =>
  accountOperationRows(LEDGER, new Set(ids), REFS);

describe("accountOperationRows", () => {
  test("счёт — все его операции одной лентой: доход, расход и перевод вместе, без снятой оплаты", () => {
    const rows = rowsFor(CASH);
    assert.deepEqual(
      rows.map((row) => row.title).sort(),
      ["Андрей", "Перевод", "Товары", "бензин"].sort(),
    );
    assert.equal(rows.find((row) => row.title === "Андрей")?.amount, 160);
  });

  test("чужая оплата того же визита на другом счёте в ленту выбранного не попадает", () => {
    const card = rowsFor(CARD);
    assert.deepEqual(
      card.map((row) => row.title).sort(),
      ["Андрей", "Перевод"].sort(),
    );
    assert.equal(card.find((row) => row.title === "Андрей")?.amount, 35);
  });

  test("перевод между счетами — одна строка «откуда → куда», даже когда выбраны оба", () => {
    const transfers = rowsFor(CASH, CARD).filter((row) => row.title === "Перевод");
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].subtitle, "Наличные → Карта");
  });

  test("каждая строка ленты называет счёт (владелец 2026-09-15)", () => {
    const lineOf = (rows: RecordRow[], title: string) => {
      const row = rows.find((candidate) => candidate.title === title);
      assert.ok(row, title);
      return whatLine(row);
    };
    const both = rowsFor(CASH, CARD);
    assert.equal(lineOf(both, "Андрей"), "10:30 · Наличные · Карта · A/C Cleaning");
    assert.equal(lineOf(both, "Товары"), "Наличные");
    assert.equal(lineOf(both, "бензин"), "Наличные");
    assert.equal(lineOf(both, "Перевод"), "Наличные → Карта");
    // В ленте одного счёта визит называет только тот счёт, чьи деньги в ней.
    assert.equal(lineOf(rowsFor(CARD), "Андрей"), "10:30 · Карта · A/C Cleaning");
  });

  test("лента выбранного счёта его имя в строках не повторяет — оно в заголовке", () => {
    const card = dropAccountNames(rowsFor(CARD));
    const line = (title: string) => {
      const row = card.find((candidate) => candidate.title === title);
      assert.ok(row, title);
      return whatLine(row);
    };
    assert.equal(line("Андрей"), "10:30 · A/C Cleaning");
    // Куда ушли деньги перевода — не повтор имени, остаётся.
    assert.equal(line("Перевод"), "Наличные → Карта");
  });

  test("все счета — визит одной строкой на всю сумму", () => {
    const both = rowsFor(CASH, CARD);
    assert.equal(both.find((row) => row.title === "Андрей")?.amount, 195);
  });

  test("свежее сверху", () => {
    const dated = accountOperationRows(
      [
        tx({ id: "old", occurred_on: "2026-09-01", category_id: "cat-goods" }),
        tx({ id: "new", occurred_on: "2026-09-14", notes: "свежий" }),
      ],
      new Set([CASH]),
      REFS,
    );
    assert.deepEqual(
      dated.map((row) => row.date),
      ["2026-09-14", "2026-09-01"],
    );
  });
});
