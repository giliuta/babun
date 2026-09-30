import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type Appointment,
} from "@babun/shared/local/appointments";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { unpaidVisits } from "./unpaid-visits";

// Даты — далеко от «сегодня» в обе стороны: сводка (`buildStats`) берёт
// настоящую сегодняшнюю дату, и сверка двух чисел не должна зависеть от дня
// прогона.
const PAST = "2020-03-01";
const FUTURE = "2099-03-01";
const today = (() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const apt = (over: Partial<Appointment>): Appointment =>
  createBlankAppointment({ client_id: "c1", total_amount: 100, ...over });

const rows: Appointment[] = [
  // Выполнена, заплачено 40 из 100 — долг 60.
  apt({ id: "part", status: "completed", date: PAST, prepaid_amount: 40 }),
  // Выполнена и оплачена — не долг.
  apt({ id: "paid", status: "completed", date: PAST, prepaid_amount: 100 }),
  // Прошла, бригада не отчиталась — долг всей суммой (владелец 2026-08-09).
  apt({ id: "unclosed", status: "scheduled", date: PAST }),
  // Отменена — не долг, сколько бы ни стоила.
  apt({ id: "cancelled", status: "cancelled", date: PAST }),
  // Впереди — ещё не долг.
  apt({ id: "ahead", status: "scheduled", date: FUTURE }),
];

describe("«Неоплаченные» — правилом долга из сводки", () => {
  test("отбирает недоплаченную выполненную и незакрытую прошедшую", () => {
    const { list, total } = unpaidVisits(rows, today);
    assert.deepEqual(
      list.map((a) => a.id).sort(),
      ["part", "unclosed"],
    );
    assert.equal(total, 160);
  });

  test("сумма списка = «Долг» в сводке по тем же записям", () => {
    const stats = buildStats(
      { id: "c1", full_name: "Мария", created_at: "", birthday: "" },
      rows,
    );
    assert.equal(unpaidVisits(rows, today).total, stats.debt);
  });
});
