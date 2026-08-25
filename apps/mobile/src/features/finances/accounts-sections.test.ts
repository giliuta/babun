import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountDaysOnHand,
  accountOrderGroups,
  accountsTeamChips,
  daysBetweenYmd,
  NO_TEAM,
  sumAccountBalances,
  teamAccounts,
  teamNamesPhrase,
  type SectionAccount,
  type SectionTeam,
} from "./accounts-sections";

type Row = SectionAccount & {
  last_outflow_on: string | null;
  first_tx_on: string | null;
};

function account(patch: Partial<Row> & { id: string; balance: number }): Row {
  return {
    scope: "team",
    brigade_id: "t-yura",
    team_ids: [],
    name: patch.id,
    kind: "cash",
    position: 0,
    last_outflow_on: null,
    first_tx_on: null,
    ...patch,
  };
}

const TEAMS: SectionTeam[] = [
  { id: "t-yura", name: "Юра", color: "#2c5be0", is_active: true },
  { id: "t-anya", name: "Аня", color: null, is_active: true },
  { id: "t-dima", name: "Дима", color: null, is_active: true },
];

// Три команды. Счёт принадлежит РОВНО ОДНОЙ (владелец 2026-08-15): «Revolut»
// остался от старой схемы общего счёта и владельца не имеет — клиент обязан
// уметь показать такие деньги, а не потерять их.
const FIXTURE: Row[] = [
  account({ id: "yura-cash", name: "Наличные", balance: 640 }),
  account({ id: "yura-card", name: "Карта", kind: "card", balance: 410 }),
  account({ id: "anya-cash", name: "Наличные", brigade_id: "t-anya", balance: 390 }),
  account({ id: "dima-cash", name: "Наличные", brigade_id: "t-dima", balance: 800 }),
  account({
    id: "dima-card",
    name: "Карта",
    kind: "card",
    brigade_id: "t-dima",
    balance: 120,
  }),
  account({
    id: "revolut",
    name: "Revolut",
    brigade_id: null,
    kind: "bank",
    balance: 5120,
  }),
];

describe("счета выбранной команды", () => {
  test("только свои; чужие не видны, а сумма равна сумме строк", () => {
    const rows = teamAccounts(FIXTURE, "t-yura");
    assert.deepEqual(
      rows.map((a) => a.id),
      ["yura-cash", "yura-card"],
    );
    // Цифру героя можно проверить пальцем: она складывается ровно из того,
    // что нарисовано ниже.
    assert.equal(sumAccountBalances(rows), 1050);
    assert.equal(rows.some((a) => a.brigade_id === "t-anya"), false);
  });

  test("СЧЁТ ПРИНАДЛЕЖИТ ОДНОЙ БРИГАДЕ: чужой в списке не появляется", () => {
    const anya = teamAccounts(FIXTURE, "t-anya");
    assert.deepEqual(
      anya.map((a) => a.id),
      ["anya-cash"],
    );
    assert.equal(sumAccountBalances(anya), 390);
  });

  test("счёт без владельца не приписывается никому", () => {
    const ids = teamAccounts(FIXTURE, "t-dima").map((a) => a.id);
    assert.deepEqual(ids, ["dima-cash", "dima-card"]);
    assert.ok(!ids.includes("revolut"));
    assert.equal(ids.length, new Set(ids).size);
  });

  test("команда, которой счёт не открыт: пустой список и честный ноль", () => {
    const rows = teamAccounts(FIXTURE, "t-kolya");
    assert.deepEqual(rows, []);
    assert.equal(sumAccountBalances(rows), 0);
  });

  test("порядок строк детерминирован: вид, position, имя", () => {
    const rows = [
      account({ id: "4", name: "Прочее", kind: "other", position: 0, balance: 0 }),
      account({ id: "3", name: "Банк", kind: "bank", position: 0, balance: 0 }),
      account({ id: "2b", name: "Ямаха", kind: "card", position: 5, balance: 0 }),
      account({ id: "2a", name: "Альфа", kind: "card", position: 5, balance: 0 }),
      account({ id: "1", name: "Наличные", kind: "cash", position: 9, balance: 0 }),
    ];
    assert.deepEqual(
      teamAccounts(rows, "t-yura").map((a) => a.id),
      ["1", "2a", "2b", "3", "4"],
    );
  });

  test("копейки складываются центами: сумма не тащит хвост float", () => {
    const rows = [
      account({ id: "a", balance: 0.1 }),
      account({ id: "b", balance: 0.2, kind: "card" }),
      account({ id: "c", balance: 0.3, kind: "bank" }),
    ];
    assert.equal(sumAccountBalances(teamAccounts(rows, "t-yura")), 0.6);
  });
});

describe("лента команд", () => {
  test("активные команды идут в порядке справочника", () => {
    // В FIXTURE есть «Revolut» без команды — за ним встаёт чип «Без команды»:
    // деньги без хозяина обязаны быть видны.
    assert.deepEqual(accountsTeamChips({ accounts: FIXTURE, teams: TEAMS }), [
      ...TEAMS.map((team) => ({
        id: team.id,
        name: team.name,
        color: team.color,
        orphan: false,
      })),
      { id: NO_TEAM, name: "Без команды", color: null, orphan: true },
    ]);
  });

  test("счёт удалённой команды не пропадает: у неё остаётся чип", () => {
    const ghost = account({
      id: "ghost-cash",
      name: "Сейф",
      // Живая фактура прода: `brigade_id` без строки в справочнике команд.
      brigade_id: "team-mpvbwqze-a8qj0",
      balance: 300,
    });
    const archived = account({
      id: "old-cash",
      name: "Касса",
      brigade_id: "t-old",
      balance: 250,
    });
    const chips = accountsTeamChips({
      accounts: [...FIXTURE, ghost, archived],
      teams: [...TEAMS, { id: "t-old", name: "Дима", color: null, is_active: false }],
    });
    // Осиротевшие — последними, после всех активных, и в том же порядке, в
    // каком идут их счета («Касса» перед «Сейфом»).
    assert.deepEqual(chips.slice(TEAMS.length), [
      { id: "t-old", name: "Дима", color: null, orphan: true },
      {
        id: "team-mpvbwqze-a8qj0",
        name: "Команда удалена",
        color: null,
        orphan: true,
      },
      { id: NO_TEAM, name: "Без команды", color: null, orphan: true },
    ]);
    // И деньги под этими чипами — настоящие.
    assert.deepEqual(
      teamAccounts([...FIXTURE, ghost, archived], "team-mpvbwqze-a8qj0").map(
        (a) => a.id,
      ),
      ["ghost-cash"],
    );
  });

  test("тенант, у которого ВСЕ счета осиротели, видит их, а не пустой экран", () => {
    const accounts = [
      account({ id: "a", name: "Касса", brigade_id: "team-gone-1", balance: 900 }),
      account({ id: "b", name: "Карта", kind: "card", brigade_id: "team-gone-2", balance: 40 }),
    ];
    const chips = accountsTeamChips({ accounts, teams: [] });
    assert.deepEqual(
      chips.map((c) => [c.id, c.name, c.orphan]),
      [
        ["team-gone-1", "Команда удалена", true],
        ["team-gone-2", "Команда удалена", true],
      ],
    );
    assert.equal(sumAccountBalances(teamAccounts(accounts, chips[0].id)), 900);
  });

  test("счёт живой команды лишнего чипа не рождает", () => {
    const chips = accountsTeamChips({
      accounts: [account({ id: "yura-cash", name: "Наличные", balance: 1000 })],
      teams: [
        ...TEAMS,
        { id: "t-old", name: "Дима", color: null, is_active: false },
      ],
    });
    assert.equal(
      chips.every((c) => !c.orphan),
      true,
    );
  });

  test("счёт без команды встаёт под свой чип, и деньги под ним настоящие", () => {
    const rows = [...FIXTURE];
    assert.deepEqual(
      teamAccounts(rows, NO_TEAM).map((a) => a.id),
      ["revolut"],
    );
    assert.equal(sumAccountBalances(teamAccounts(rows, NO_TEAM)), 5120);
  });
});

describe("имена команд одной фразой", () => {
  test("до трёх перечисляются, дальше — склонённый счётчик", () => {
    assert.equal(teamNamesPhrase([]), "");
    assert.equal(teamNamesPhrase(["Юра"]), "Юра");
    assert.equal(teamNamesPhrase(["Юра", "Аня", "Дима"]), "Юра, Аня, Дима");
    assert.equal(
      teamNamesPhrase(["Юра", "Аня", "Дима", "Коля"]),
      "Юра, Аня и ещё 2 команды",
    );
    assert.equal(
      teamNamesPhrase(["Юра", "Аня", "Дима", "Коля", "Петя", "Вася", "Гена"]),
      "Юра, Аня и ещё 5 команд",
    );
  });
});

describe("группы страницы «Порядок счетов»", () => {
  test("по командам, счёт без владельца — последней группой", () => {
    const groups = accountOrderGroups({ accounts: FIXTURE, teams: TEAMS });
    assert.deepEqual(
      groups.map((g) => [g.title, g.data.map((a) => a.id)]),
      [
        ["Команда Юра", ["yura-cash", "yura-card"]],
        ["Команда Аня", ["anya-cash"]],
        ["Команда Дима", ["dima-cash", "dima-card"]],
        ["Без команды", ["revolut"]],
      ],
    );
    // Каждый счёт ровно в одной группе: `position` нумеруется внутри неё.
    const drawn = groups.flatMap((g) => g.data.map((a) => a.id));
    assert.equal(drawn.length, FIXTURE.length);
    assert.equal(drawn.length, new Set(drawn).size);
  });

  test("имя команды не удваивает слово: «Команда 2», а не «Команда Команда 2»", () => {
    const groups = accountOrderGroups({
      accounts: [
        account({ id: "a", brigade_id: "t1", balance: 1 }),
        account({ id: "b", brigade_id: "t2", balance: 2 }),
      ],
      teams: [
        { id: "t1", name: "Команда 2", color: null, is_active: true },
        { id: "t2", name: "Команда Юга", color: null, is_active: true },
      ],
    });
    assert.deepEqual(
      groups.map((g) => g.title),
      ["Команда 2", "Команда Юга"],
    );
  });

  test("архивные и неразрешимые команды переставлять нечем", () => {
    const groups = accountOrderGroups({
      accounts: [
        ...FIXTURE,
        account({ id: "old", brigade_id: "t-old", balance: 250 }),
        // Живая фактура прода: `brigade_id` без строки в справочнике команд.
        account({ id: "ghost", brigade_id: "team-mpvbwqze-a8qj0", balance: 300 }),
      ],
      teams: [
        ...TEAMS,
        { id: "t-old", name: "Дима", color: null, is_active: false },
      ],
    });
    const drawn = groups.flatMap((g) => g.data.map((a) => a.id));
    assert.equal(drawn.includes("old"), false);
    assert.equal(drawn.includes("ghost"), false);
  });
});

describe("возраст остатка", () => {
  test("дни считаются от последней сдачи, а без неё — от первой операции", () => {
    assert.equal(
      accountDaysOnHand(
        { last_outflow_on: "2026-08-04", first_tx_on: "2026-06-01" },
        "2026-08-10",
      ),
      6,
    );
    assert.equal(
      accountDaysOnHand({ last_outflow_on: null, first_tx_on: "2026-08-01" }, "2026-08-10"),
      9,
    );
    // Движений не было вовсе — возраст неизвестен, и выдумывать его нельзя.
    assert.equal(
      accountDaysOnHand({ last_outflow_on: null, first_tx_on: null }, "2026-08-10"),
      null,
    );
    assert.equal(daysBetweenYmd("не дата", "2026-08-10"), null);
  });
});
