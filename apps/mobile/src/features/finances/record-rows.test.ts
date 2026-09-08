import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Appointment } from "@babun/shared/local/appointments";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  recordRows,
  servicesLine,
  whenLine,
  type RecordRowRefs,
} from "./record-rows";

const appt = (over: Partial<Appointment>): Appointment =>
  ({
    id: "a1",
    client_id: "c1",
    team_id: "t1",
    date: "2026-09-06",
    time_start: "11:30",
    time_end: "13:00",
    status: "completed",
    service_ids: ["s1"],
    services: [{ serviceId: "s1", serviceName: "A/C Cleaning" }],
    ...over,
  }) as unknown as Appointment;

const tx = (over: Partial<FinanceTransaction>): FinanceTransaction =>
  ({
    id: "tx1",
    type: "income",
    amount: 50,
    appointment_id: "a1",
    category_id: null,
    notes: null,
    occurred_on: "2026-09-06",
    occurred_time: "17:45",
    ...over,
  }) as unknown as FinanceTransaction;

const refs: RecordRowRefs = {
  appointments: [appt({})],
  clients: [{ id: "c1", full_name: "Константин" }],
  services: [{ id: "s1", name: "A/C Cleaning" }],
  categories: [{ id: "cat1", name: "Топливо" }],
};

describe("recordRows", () => {
  test("предоплата и доплата одного визита — одна строка с общей суммой", () => {
    const rows = recordRows(
      [tx({ id: "tx1", amount: 50 }), tx({ id: "tx2", amount: 85 })],
      refs,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 135);
    assert.equal(rows[0].count, 2);
    assert.equal(rows[0].appointmentId, "a1");
    assert.equal(rows[0].title, "Константин");
    assert.deepEqual(rows[0].services, ["A/C Cleaning"]);
  });

  test("частичный возврат уменьшает сумму визита, строка остаётся одна", () => {
    const rows = recordRows(
      [tx({ id: "tx1", amount: 135 }), tx({ id: "tx2", type: "refund", amount: -35 })],
      refs,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 100);
    assert.equal(rows[0].count, 2);
  });

  test("копейки после сложения не всплывают", () => {
    const rows = recordRows(
      [tx({ id: "tx1", amount: 44.4 }), tx({ id: "tx2", amount: 34.4 })],
      refs,
    );
    assert.equal(rows[0].amount, 78.8);
  });

  test("строка берёт время и дату ВИЗИТА, а не проводки", () => {
    const rows = recordRows([tx({ occurred_on: "2026-09-08", occurred_time: "22:10" })], refs);
    assert.equal(rows[0].date, "2026-09-06");
    assert.equal(rows[0].time, "11:30");
  });

  test("расход визита приходит со своим знаком", () => {
    const rows = recordRows([tx({ type: "expense", amount: 10 })], refs);
    assert.equal(rows[0].amount, -10);
  });

  test("имя услуги берётся из снимка записи, даже если каталог переименовали", () => {
    const rows = recordRows([tx({})], {
      ...refs,
      services: [{ id: "s1", name: "Чистка сплит-системы" }],
    });
    assert.deepEqual(rows[0].services, ["A/C Cleaning"]);
  });

  test("запись без снимка услуг падает на каталог", () => {
    const rows = recordRows([tx({})], {
      ...refs,
      appointments: [appt({ services: [], service_ids: ["s1"] })],
    });
    assert.deepEqual(rows[0].services, ["A/C Cleaning"]);
  });

  test("услуга, стёртая из каталога и без снимка, не даёт пустого имени", () => {
    const rows = recordRows([tx({})], {
      ...refs,
      appointments: [appt({ services: [], service_ids: ["ghost"] })],
    });
    assert.deepEqual(rows[0].services, []);
  });

  test("запись без клиента называет себя честно", () => {
    const rows = recordRows([tx({})], {
      ...refs,
      appointments: [appt({ client_id: null })],
    });
    assert.equal(rows[0].title, "Без клиента");
  });

  test("ручная операция — своя строка с категорией и без услуг", () => {
    const rows = recordRows(
      [tx({ id: "m1", appointment_id: null, type: "expense", amount: 55, category_id: "cat1" })],
      refs,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].appointmentId, null);
    assert.equal(rows[0].key, "m1");
    assert.equal(rows[0].title, "Топливо");
    assert.deepEqual(rows[0].services, []);
    assert.equal(rows[0].amount, -55);
    assert.equal(rows[0].time, "17:45");
  });

  test("ручная операция без категории берёт заметку, иначе — слово", () => {
    const [withNote] = recordRows(
      [tx({ id: "m1", appointment_id: null, notes: "Обед бригады" })],
      refs,
    );
    assert.equal(withNote.title, "Обед бригады");
    const [bare] = recordRows([tx({ id: "m2", appointment_id: null })], refs);
    assert.equal(bare.title, "Операция");
  });

  test("проводка на запись вне окна периода не теряется", () => {
    const rows = recordRows([tx({ appointment_id: "gone" })], refs);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].appointmentId, null);
    assert.equal(rows[0].date, "2026-09-06");
  });

  test("порядок — от свежего к старому, по дате и времени визита", () => {
    const rows = recordRows(
      [
        tx({ id: "t1", appointment_id: "a1" }),
        tx({ id: "t2", appointment_id: "a2" }),
        tx({ id: "t3", appointment_id: "a3" }),
      ],
      {
        ...refs,
        appointments: [
          appt({ id: "a1", date: "2026-09-06", time_start: "11:30" }),
          appt({ id: "a2", date: "2026-09-07", time_start: "09:00" }),
          appt({ id: "a3", date: "2026-09-06", time_start: "15:00" }),
        ],
      },
    );
    assert.deepEqual(
      rows.map((r) => r.key),
      ["a2", "a3", "a1"],
    );
  });
});

describe("servicesLine", () => {
  test("без услуг — пусто, строка сама поставит прочерк", () => {
    assert.equal(servicesLine([]), "");
  });

  test("одна и две услуги печатаются целиком", () => {
    assert.equal(servicesLine(["A/C Cleaning"]), "A/C Cleaning");
    assert.equal(
      servicesLine(["A/C Cleaning", "Замена фильтра"]),
      "A/C Cleaning · Замена фильтра",
    );
  });

  test("с третьей услуги остаток сворачивается в «+N», а не режется многоточием", () => {
    assert.equal(
      servicesLine(["A/C Cleaning", "Замена фильтра", "Дозаправка"]),
      "A/C Cleaning · Замена фильтра +1",
    );
    assert.equal(servicesLine(["a", "b", "c", "d", "e"]), "a · b +3");
  });
});

describe("whenLine", () => {
  test("один платёж — только время: считать нечего", () => {
    assert.equal(whenLine({ time: "11:30", count: 1 }), "11:30");
  });

  test("несколько платежей склоняются по-русски", () => {
    assert.equal(whenLine({ time: "11:30", count: 2 }), "11:30 · 2 платежа");
    assert.equal(whenLine({ time: "11:30", count: 5 }), "11:30 · 5 платежей");
    assert.equal(whenLine({ time: "11:30", count: 21 }), "11:30 · 21 платёж");
  });

  test("без времени остаётся только счёт платежей", () => {
    assert.equal(whenLine({ time: null, count: 3 }), "3 платежа");
    assert.equal(whenLine({ time: null, count: 1 }), "");
  });
});
