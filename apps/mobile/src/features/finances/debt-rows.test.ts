import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import { debtRows, type DebtWindow } from "./debt-rows";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-06",
    time_start: "11:30",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", serviceName: "A/C Cleaning" }],
    total_amount: 135,
    // Долг считается по леджеру платежей и статусу, а не по колонке
    // paid_amount: у неё своя история бэкфилла (см. getPaidAmount).
    payment_status: "partial",
    prepaid_amount: 0,
    paid_amount: 100,
    payments: [{ id: "p1", amount: 100, method: "cash", paid_at: "2026-09-06T12:00:00Z" }],
    ...over,
  }) as unknown as Appointment;

const clients = [
  { id: "c1", full_name: "Константин Петров", phone: " +357 111 " },
];
const services = [{ id: "s1", name: "A/C Cleaning" }];

const win = (over: Partial<DebtWindow> = {}): DebtWindow => ({
  from: "2026-09-01",
  to: "2026-09-30",
  today: "2026-09-09",
  teamId: "t1",
  invoicedAppointmentIds: new Set<string>(),
  ...over,
});

describe("debtRows", () => {
  test("завершённый визит с недоплатой — строка долга с клиентом и услугой", () => {
    const [row] = debtRows([appt({})], clients, services, win());
    assert.equal(row.title, "Константин Петров");
    assert.deepEqual(row.services, ["A/C Cleaning"]);
    assert.equal(row.amount, 35);
    assert.equal(row.tone, "debt");
    assert.equal(row.appointmentId, "a1");
    assert.equal(row.time, "11:30");
    assert.equal(row.phone, "+357 111");
    assert.equal(row.firstName, "Константин");
    assert.equal(row.unclosed, false);
  });

  test("оплаченный визит долгом не считается", () => {
    assert.equal(
      debtRows(
        [
          appt({
            payment_status: "paid",
            paid_amount: 135,
            payments: [{ id: "p1", amount: 135, method: "cash", paid_at: "2026-09-06T12:00:00Z" }],
          }),
        ],
        clients,
        services,
        win(),
      ).length,
      0,
    );
  });

  test("отменённая запись выпадает, будущая — тоже", () => {
    assert.equal(
      debtRows([appt({ status: "cancelled" })], clients, services, win()).length,
      0,
    );
    // Запланирована и ещё не наступила: команда не опоздала с отчётом.
    assert.equal(
      debtRows(
        [appt({ status: "scheduled", date: "2026-09-20" })],
        clients,
        services,
        win(),
      ).length,
      0,
    );
  });

  test("прошедшая незакрытая запись — долг, но помечена как несданная", () => {
    const [row] = debtRows(
      [appt({ status: "scheduled", date: "2026-09-02" })],
      clients,
      services,
      win(),
    );
    assert.equal(row.unclosed, true);
    assert.equal(row.amount, 35);
  });

  test("ушедшее под счёт не считается дважды", () => {
    assert.equal(
      debtRows([appt({})], clients, services, win({
        invoicedAppointmentIds: new Set(["a1"]),
      })).length,
      0,
    );
  });

  test("чужая команда и чужой период не попадают", () => {
    assert.equal(
      debtRows([appt({ team_id: "t2" })], clients, services, win()).length,
      0,
    );
    assert.equal(
      debtRows([appt({ date: "2026-08-30" })], clients, services, win()).length,
      0,
    );
  });

  test("запись без клиента называет себя комментарием, иначе — «Без имени»", () => {
    const [named] = debtRows(
      [appt({ client_id: null, comment: "Соседний подъезд" })],
      clients,
      services,
      win(),
    );
    assert.equal(named.title, "Соседний подъезд");
    assert.equal(named.firstName, "");
    const [bare] = debtRows([appt({ client_id: null })], clients, services, win());
    assert.equal(bare.title, "Без имени");
  });

  test("порядок — от свежего к старому", () => {
    const rows = debtRows(
      [
        appt({ id: "old", date: "2026-09-02" }),
        appt({ id: "new", date: "2026-09-07" }),
      ],
      clients,
      services,
      win(),
    );
    assert.deepEqual(
      rows.map((r) => r.key),
      ["new", "old"],
    );
  });
});
