import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { DayExtra } from "@babun/shared/local/day-extras";
import { recordRows, whatLine, type RecordRowRefs } from "@/features/finances/record-rows";
import { dayExtraRow, dayTxRow, dayTxTone } from "./day-rows";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-10-22",
    time_start: "10:00",
    time_end: "11:00",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", serviceName: "A/C Чистка" }],
    ...over,
  }) as unknown as Appointment;

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx1",
    type: "income",
    amount: 180,
    appointment_id: "a1",
    client_id: "c1",
    account_id: "cash",
    category_id: null,
    notes: null,
    occurred_on: "2026-10-22",
    occurred_time: "10:40",
    ...over,
  }) as unknown as FinanceTransaction;

const refs: RecordRowRefs = {
  appointments: [],
  clients: [{ id: "c1", full_name: "Тест QA Иванов" }],
  services: [{ id: "s1", name: "A/C Чистка" }],
  categories: [{ id: "fuel", name: "Бензин" }],
  accounts: [{ id: "cash", name: "Наличные" }],
  window: { from: "2026-10-22", to: "2026-10-22" },
};

describe("строка операции дня = строка ленты", () => {
  test("оплата записи: клиент заголовком, «время · счёт · услуги» подписью", () => {
    const a = appt({});
    const day = dayTxRow(tx({}), refs, a)!;
    const [feed] = recordRows([tx({})], { ...refs, appointments: [a], window: { from: "2026-10-01", to: "2026-10-31" } });
    assert.equal(day.title, "Тест QA Иванов");
    assert.equal(whatLine(day), "10:00 · Наличные · A/C Чистка");
    assert.equal(day.title, feed!.title);
    assert.equal(whatLine(day), whatLine(feed!));
    assert.equal(day.amount, feed!.amount);
  });

  test("предоплата за другой день — подпись «за …», как в ленте вне окна", () => {
    const day = dayTxRow(tx({}), refs, appt({ date: "2026-10-25" }))!;
    assert.match(whatLine(day), /за 25 октября/);
  });

  test("расход — с минусом, тон расхода; возврат — в доходе", () => {
    const fuel = tx({ type: "expense", amount: 20, appointment_id: null, client_id: null, category_id: "fuel" });
    const row = dayTxRow(fuel, refs, undefined)!;
    assert.equal(row.amount, -20);
    assert.equal(dayTxTone(fuel), "expense");
    assert.equal(dayTxTone(tx({ type: "refund" })), "income");
  });
});

test("старая ручная операция — строкой той же формы", () => {
  const e = { id: "e1", name: "Обед", amount: 15, kind: "expense" } as DayExtra;
  const row = dayExtraRow(e, "2026-10-22");
  assert.equal(row.amount, -15);
  assert.equal(whatLine(row), "Ручная операция");
});

test("запись плана: «время · счёт · услуги» через «·», как в ленте", async () => {
  const { recordAccountTags } = await import("./day-rows");
  const accounts = [
    { id: "cash", name: "Cash" },
    { id: "card", name: "Card" },
  ];
  const tags = recordAccountTags(
    "a1",
    [
      { appointment_id: "a1", account_id: "card" },
      { appointment_id: "a2", account_id: "cash" },
    ],
    accounts,
  );
  const a = appt({
    time_start: "11:00",
    services: [
      { serviceId: "s1", serviceName: "A/C Cleaning" },
      { serviceId: "s2", serviceName: "A/C Cleaning (Commercial)" },
    ] as never,
  });
  const { appointmentServiceNames } = await import("@/features/finances/record-rows");
  const line = whatLine({ time: "11:00", services: appointmentServiceNames(a, new Map()), accounts: tags });
  assert.equal(line, "11:00 · Card · A/C Cleaning · A/C Cleaning (Commercial)");
  assert.equal(recordAccountTags("a3", [], accounts), undefined);
});
