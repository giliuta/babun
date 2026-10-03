import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NO_TEAM } from "./accounts-sections";
import {
  hasTeamlessMoney,
  inTeamScope,
  teamlessLedgerRows,
  withTeamlessRows,
} from "./team-scope";

// Данные Giliuta 15.09: три строки без команды на счёте «Revolut Business»
// Команды 1 — перевод 5.00, доход 59.50 и возврат −59.50.
const T1 = "team-1";
const T3 = "team-3";
const REVOLUT = "acc-revolut";
const ORPHAN = "acc-orphan";
const accountTeam = new Map<string, string | null>([
  [REVOLUT, T1],
  ["acc-cash-3", T3],
  [ORPHAN, null],
]);

const row = (id: string, team_id: string | null, account_id: string | null) => ({
  id,
  team_id,
  account_id,
});

describe("inTeamScope", () => {
  test("без чипа — вся компания", () => {
    assert.equal(inTeamScope("team-1", null), true);
    assert.equal(inTeamScope(null, null), true);
  });

  test("чип команды — только её строки", () => {
    assert.equal(inTeamScope(T1, T1), true);
    assert.equal(inTeamScope(T3, T1), false);
    assert.equal(inTeamScope(null, T1), false);
  });

  test("«Без команды» — только строки без команды", () => {
    assert.equal(inTeamScope(null, NO_TEAM), true);
    assert.equal(inTeamScope(undefined, NO_TEAM), true);
    assert.equal(inTeamScope(T1, NO_TEAM), false);
  });
});

describe("teamlessLedgerRows", () => {
  const rows = [
    row("transfer-5", null, REVOLUT),
    row("income-59", null, REVOLUT),
    row("team-row", T1, REVOLUT),
    row("orphan-row", null, ORPHAN),
    row("no-account", null, null),
    row("gone-account", null, "acc-deleted"),
  ];

  test("под командой счёта — строки без команды на её счетах", () => {
    assert.deepEqual(
      teamlessLedgerRows(rows, T1, accountTeam).map((r) => r.id),
      ["transfer-5", "income-59"],
    );
    assert.deepEqual(teamlessLedgerRows(rows, T3, accountTeam), []);
  });

  test("под «Без команды» — без счёта, на сироте и на удалённом счёте", () => {
    assert.deepEqual(
      teamlessLedgerRows(rows, NO_TEAM, accountTeam).map((r) => r.id),
      ["orphan-row", "no-account", "gone-account"],
    );
  });

  test("без чипа добавлять нечего — компания уже целиком", () => {
    assert.deepEqual(teamlessLedgerRows(rows, null, accountTeam), []);
  });
});

describe("withTeamlessRows", () => {
  test("добавляет без повторов", () => {
    const scoped = [row("a", T1, REVOLUT), row("b", T1, REVOLUT)];
    const merged = withTeamlessRows(scoped, [row("b", T1, REVOLUT), row("c", null, REVOLUT)]);
    assert.deepEqual(merged.map((r) => r.id), ["a", "b", "c"]);
  });

  test("нечего добавить — тот же массив", () => {
    const scoped = [row("a", T1, REVOLUT)];
    assert.equal(withTeamlessRows(scoped, []), scoped);
    assert.equal(withTeamlessRows(scoped, [row("a", T1, REVOLUT)]), scoped);
  });
});

describe("hasTeamlessMoney", () => {
  const none = { appointments: [], debts: [], companyRows: [], accountTeam };

  test("у Giliuta чип не нужен: строки без команды лежат на счёте команды", () => {
    assert.equal(
      hasTeamlessMoney({ ...none, companyRows: [row("transfer-5", null, REVOLUT)] }),
      false,
    );
  });

  test("рабочая запись без команды — нужен; событие без команды — нет", () => {
    assert.equal(hasTeamlessMoney({ ...none, appointments: [{ team_id: null, kind: "work" }] }), true);
    assert.equal(hasTeamlessMoney({ ...none, appointments: [{ team_id: null, kind: "personal" }] }), false);
  });

  test("долг без команды — нужен", () => {
    assert.equal(hasTeamlessMoney({ ...none, debts: [{ team_id: null }] }), true);
  });

  test("доход без счёта и без команды — нужен", () => {
    assert.equal(hasTeamlessMoney({ ...none, companyRows: [row("x", null, null)] }), true);
  });
});
