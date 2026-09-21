import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  archivedCalendarCaption,
  archivedCalendars,
  type ArchivedCalendar,
} from "./calendar-archive";

const teams = [
  { id: "live", name: "Команда 1", is_active: true, position: 0 },
  { id: "b", name: "Команда 2", is_active: false, position: 2, color: "#f00" },
  { id: "a", name: "Y&D", is_active: false, position: 1 },
];

describe("архив календарей", () => {
  test("в архиве только выключенные, в порядке ленты", () => {
    const rows = archivedCalendars({ teams, appointments: [], accounts: [] });
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Y&D", "Команда 2"],
    );
  });

  test("у каждого — его записи, его счета и деньги на них", () => {
    const [yd, team2] = archivedCalendars({
      teams,
      appointments: [{ team_id: "b" }, { team_id: "b" }, { team_id: "live" }],
      accounts: [
        { brigade_id: "b", balance: 95 },
        { brigade_id: "b", balance: 490 },
        { brigade_id: "live", balance: 1000 },
      ],
    });
    assert.deepEqual(yd, {
      id: "a", name: "Y&D", color: null, appointments: 0, accounts: 0, balance: 0,
    });
    assert.deepEqual(team2, {
      id: "b", name: "Команда 2", color: "#f00", appointments: 2, accounts: 2, balance: 585,
    });
  });
});

describe("подпись строки архива", () => {
  const calendar = (over: Partial<ArchivedCalendar>): ArchivedCalendar => ({
    id: "x", name: "X", color: null, appointments: 0, accounts: 0, balance: 0, ...over,
  });
  const eur = (amount: number) => `€${amount}`;

  test("записи, счета и деньги на них через точку", () => {
    assert.equal(
      archivedCalendarCaption(calendar({ appointments: 14, accounts: 2, balance: 585 }), eur),
      "14 записей · 2 счёта · €585",
    );
  });

  // «€0» рядом со счётом читается как ошибка, а не как пустая касса.
  test("пустые кассы — без суммы", () => {
    assert.equal(
      archivedCalendarCaption(calendar({ appointments: 1, accounts: 1, balance: 0 }), eur),
      "1 запись · 1 счёт",
    );
  });

  test("долг на счёте — тоже деньги", () => {
    assert.equal(
      archivedCalendarCaption(calendar({ accounts: 1, balance: -40 }), eur),
      "1 счёт · €-40",
    );
  });

  test("пустой так и говорит", () => {
    assert.equal(archivedCalendarCaption(calendar({}), eur), "Пустой");
  });
});
