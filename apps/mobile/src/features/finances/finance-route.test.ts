import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NO_TEAM } from "./accounts-sections";
import {
  fallbackScope,
  fallbackScopeUpdate,
  financeRoute,
  routeParam,
} from "./finance-route";

// Id команд — ровно той формы, что лежит в боевой базе (2026-09-15): ни один
// не uuid. На выдуманном uuid тест проходил, а настоящие адреса выбрасывались.
const TEAM = "team-mp8379ea-i8ith";
const SEED_TEAM = "team_north";
const ACCOUNT = "7f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

describe("financeRoute", () => {
  test("без разреза адрес ничего не переставляет", () => {
    assert.equal(financeRoute({}), null);
    assert.equal(financeRoute({ team: TEAM, account: ACCOUNT }), null);
  });

  test("незнакомый разрез отбрасывается", () => {
    assert.equal(financeRoute({ view: "all" }), null);
    assert.equal(financeRoute({ view: "../cabinet" }), null);
  });

  test("«Счета» с командой и счётом", () => {
    assert.deepEqual(
      financeRoute({ view: "accounts", team: TEAM, account: ACCOUNT }),
      { view: "accounts", team: TEAM, account: ACCOUNT },
    );
  });

  test("настоящие id команд из базы проходят — и через «-», и через «_»", () => {
    assert.equal(financeRoute({ view: "accounts", team: TEAM })?.team, TEAM);
    assert.equal(
      financeRoute({ view: "accounts", team: SEED_TEAM })?.team,
      SEED_TEAM,
    );
  });

  test("ссылка старого списка: «Счета» одной команды без счёта", () => {
    assert.deepEqual(financeRoute({ view: "accounts", team: TEAM }), {
      view: "accounts",
      team: TEAM,
      account: null,
    });
  });

  test("чип «Без команды» — законная команда адреса", () => {
    assert.equal(financeRoute({ view: "accounts", team: NO_TEAM })?.team, NO_TEAM);
  });

  test("мусор в команде и не-uuid в счёте отбрасываются", () => {
    assert.deepEqual(
      financeRoute({ view: "accounts", team: "1 or 1=1", account: "x&view=profit" }),
      { view: "accounts", team: null, account: null },
    );
    assert.equal(financeRoute({ view: "accounts", team: "a'b" })?.team, null);
    assert.equal(
      financeRoute({ view: "accounts", account: SEED_TEAM })?.account,
      null,
    );
  });

  test("команда и счёт у других разрезов не читаются", () => {
    assert.deepEqual(
      financeRoute({ view: "income", team: TEAM, account: ACCOUNT }),
      { view: "income", team: null, account: null },
    );
  });

  test("повтор ключа в адресе даёт массив — берётся первое", () => {
    assert.equal(routeParam(["accounts", "income"]), "accounts");
    assert.equal(routeParam("  "), undefined);
    assert.equal(
      financeRoute({ view: ["accounts"], team: [TEAM, "junk"] })?.team,
      TEAM,
    );
  });
});

describe("команда по умолчанию", () => {
  const TEAMS = { teamIds: [SEED_TEAM, TEAM], accountsLoaded: true, hasOrphans: false };

  test("нет команды или она пропала — первая живая; законная остаётся", () => {
    assert.equal(fallbackScope(null, TEAMS), SEED_TEAM);
    assert.equal(fallbackScope("team-archived", TEAMS), SEED_TEAM);
    assert.equal(fallbackScope(TEAM, TEAMS), TEAM);
  });

  test("«Без команды» живёт, пока есть бесхозные счета", () => {
    assert.equal(fallbackScope(NO_TEAM, { ...TEAMS, hasOrphans: true }), NO_TEAM);
    assert.equal(fallbackScope(NO_TEAM, { ...TEAMS, accountsLoaded: false }), NO_TEAM);
    assert.equal(fallbackScope(NO_TEAM, TEAMS), SEED_TEAM);
    assert.equal(
      fallbackScope(NO_TEAM, { teamIds: [], accountsLoaded: true, hasOrphans: false }),
      null,
    );
  });

  /** Очередь обновлений одного кадра, как её разбирает React: значение
   *  заменяет, функция получает то, что стоит перед ней. */
  const drain = (
    start: string | null,
    queue: readonly (string | null | ((current: string | null) => string | null))[],
  ) =>
    queue.reduce<string | null>(
      (state, update) => (typeof update === "function" ? update(state) : update),
      start,
    );

  test("ВОЗВРАТ ИЗ ЗАПИСИ: команда счёта из адреса переживает запасной выбор того же кадра", () => {
    // Вкладка пересоздана: `scope` в замыкании — null. Первым эффектом адрес
    // ставит команду выбранного счёта, вторым экран зовёт запасной выбор.
    assert.equal(drain(null, [TEAM, fallbackScopeUpdate(TEAMS)]), TEAM);
    assert.equal(
      drain(null, [NO_TEAM, fallbackScopeUpdate({ ...TEAMS, hasOrphans: true })]),
      NO_TEAM,
    );
    // Без адреса тот же кадр по-прежнему открывает первую команду.
    assert.equal(drain(null, [fallbackScopeUpdate(TEAMS)]), SEED_TEAM);
  });
});
