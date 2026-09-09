import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Debt } from "@babun/shared/local/finance/debt";
import {
  debtRows,
  manualDebtRows,
  mergeDebtRows,
  type DebtWindow,
} from "./debt-rows";

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

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: "d1",
  tenant_id: "tn",
  direction: "outgoing",
  client_id: null,
  counterparty: "Gree",
  amount: 900,
  currency: "EUR",
  category_id: "cat-1",
  note: null,
  occurred_on: "2026-09-01",
  team_id: null,
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

const cats = [{ id: "cat-1", name: "Поставщики" }];

describe("manualDebtRows", () => {
  test("«я должен» — строка с контрагентом, категорией и возрастом", () => {
    const [row] = manualDebtRows([debt()], new Map(), { clients, categories: cats }, {
      today: "2026-09-09",
    });
    assert.equal(row.title, "Gree");
    assert.equal(row.subtitle, "Поставщики");
    assert.equal(row.amount, 900);
    assert.equal(row.direction, "outgoing");
    assert.equal(row.debtId, "d1");
    assert.equal(row.appointmentId, null);
    assert.equal(row.tone, "debt");
    assert.equal(row.caption, "8 дней");
  });

  test("сумма строки — ОСТАТОК: платёж уменьшает висящие деньги", () => {
    const [row] = manualDebtRows(
      [debt()],
      new Map([["d1", 300]]),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.equal(row.amount, 600);
  });

  test("закрытый долг уходит из списка сам, удалять его не нужно", () => {
    const rows = manualDebtRows(
      [debt()],
      new Map([["d1", 900]]),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.deepEqual(rows, []);
  });

  test("копеечный хвост не оставляет закрытый долг висеть", () => {
    const rows = manualDebtRows(
      [debt({ amount: 0.3 })],
      new Map([["d1", 0.1 + 0.2]]),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.deepEqual(rows, []);
  });

  test("направление режет список: «мне должны» не показывает «я должен»", () => {
    const rows = manualDebtRows(
      [debt(), debt({ id: "d2", direction: "incoming", counterparty: "Вася" })],
      new Map(),
      { clients, categories: cats },
      { today: "2026-09-09", direction: "incoming" },
    );
    assert.deepEqual(rows.map((r) => r.title), ["Вася"]);
  });

  test("клиент из справочника даёт имя и телефон, контрагент — запасное имя", () => {
    const [withClient, freeText] = manualDebtRows(
      [
        debt({ id: "d2", client_id: "c1", counterparty: "Петров" }),
        debt({ id: "d3", counterparty: "Магазин у дома" }),
      ],
      new Map(),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.equal(withClient.title, "Константин Петров");
    assert.equal(withClient.phone, "+357 111");
    assert.equal(freeText.title, "Магазин у дома");
    assert.equal(freeText.phone, null);
    assert.equal(freeText.firstName, "Магазин");
  });

  test("без категории вторая строка берёт заметку", () => {
    const [row] = manualDebtRows(
      [debt({ category_id: null, note: "  кондиционеры  " })],
      new Map(),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.equal(row.subtitle, "кондиционеры");
  });
});

describe("mergeDebtRows", () => {
  test("долги записей и ручные — один список, свежие сверху", () => {
    const fromRecords = debtRows([appt({ date: "2026-09-05" })], clients, services, win());
    const manual = manualDebtRows(
      [debt({ occurred_on: "2026-09-07" })],
      new Map(),
      { clients, categories: cats },
      { today: "2026-09-09" },
    );
    assert.deepEqual(
      mergeDebtRows(fromRecords, manual).map((r) => r.date),
      ["2026-09-07", "2026-09-05"],
    );
  });
});
