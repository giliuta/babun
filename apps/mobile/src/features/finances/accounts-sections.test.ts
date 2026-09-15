import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountDaysOnHand,
  accountOrderGroups,
  accountsDoorLine,
  closedCountValue,
  daysBetweenYmd,
  financeAccountsHref,
  NO_TEAM,
  teamAccounts,
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
  account({ id: "yura-card", name: "Карта", kind: "card", position: 1, balance: 410 }),
  account({ id: "anya-cash", name: "Наличные", brigade_id: "t-anya", balance: 390 }),
  account({ id: "dima-cash", name: "Наличные", brigade_id: "t-dima", balance: 800 }),
  account({
    id: "dima-card",
    name: "Карта",
    kind: "card",
    position: 1,
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

const ids = (rows: readonly SectionAccount[]) => rows.map((a) => a.id);

describe("счета выбранной команды", () => {
  test("только свои; чужие не видны", () => {
    assert.deepEqual(ids(teamAccounts(FIXTURE, "t-yura")), ["yura-cash", "yura-card"]);
    assert.deepEqual(ids(teamAccounts(FIXTURE, "t-anya")), ["anya-cash"]);
  });

  test("счёт без владельца не приписывается никому", () => {
    const rows = ids(teamAccounts(FIXTURE, "t-dima"));
    assert.deepEqual(rows, ["dima-cash", "dima-card"]);
    assert.ok(!rows.includes("revolut"));
  });

  test("команда, которой счёт не открыт: пустой список", () => {
    assert.deepEqual(teamAccounts(FIXTURE, "t-kolya"), []);
  });

  test("порядок строк детерминирован: position, затем имя", () => {
    const rows = [
      account({ id: "4", name: "Прочее", kind: "other", position: 3, balance: 0 }),
      account({ id: "3", name: "Банк", kind: "bank", position: 2, balance: 0 }),
      account({ id: "2b", name: "Ямаха", kind: "card", position: 1, balance: 0 }),
      account({ id: "2a", name: "Альфа", kind: "card", position: 1, balance: 0 }),
      account({ id: "1", name: "Наличные", kind: "cash", position: 0, balance: 0 }),
    ];
    assert.deepEqual(ids(teamAccounts(rows, "t-yura")), ["1", "2a", "2b", "3", "4"]);
  });

  test("РУКА СИЛЬНЕЕ ВИДА: карта, поднятая выше кассы, остаётся выше", () => {
    // До 2026-09-12 первым ключом стоял вид счёта, и перетаскивание внутри
    // списка ничего не меняло: строка возвращалась на место.
    const rows = [
      account({ id: "card", name: "Карта", kind: "card", position: 0, balance: 0 }),
      account({ id: "cash", name: "Наличные", kind: "cash", position: 1, balance: 0 }),
    ];
    assert.deepEqual(ids(teamAccounts(rows, "t-yura")), ["card", "cash"]);
  });

  test("счёт без команды встаёт под свою группу", () => {
    assert.deepEqual(ids(teamAccounts(FIXTURE, NO_TEAM)), ["revolut"]);
  });
});

describe("группы страницы «Счета»", () => {
  test("живые команды в порядке справочника, «Без команды» последней", () => {
    const groups = accountOrderGroups({ accounts: FIXTURE, teams: TEAMS });
    assert.deepEqual(
      groups.map((g) => [g.key, g.title, ids(g.accounts)]),
      [
        ["t-yura", "Юра", ["yura-cash", "yura-card"]],
        ["t-anya", "Аня", ["anya-cash"]],
        ["t-dima", "Дима", ["dima-cash", "dima-card"]],
        [NO_TEAM, "Без команды", ["revolut"]],
      ],
    );
  });

  test("ДЕНЬГИ АРХИВНОЙ И УДАЛЁННОЙ КОМАНДЫ ВИДНЫ: у каждой своя названная группа", () => {
    // Живая фактура прода: у Giliuta архивная команда держит открытые «Карту»
    // и «Наличку» с деньгами; у другого тенанта счёт ссылается на команду,
    // строки которой уже нет. «Финансы» таких команд не показывают вовсе.
    const archivedCard = account({
      id: "old-card",
      name: "Карта",
      kind: "card",
      brigade_id: "t-old",
      balance: 490,
    });
    const archivedCash = account({
      id: "old-cash",
      name: "Наличка",
      brigade_id: "t-old",
      position: 1,
      balance: 95,
    });
    const ghost = account({
      id: "ghost-cash",
      name: "Сейф",
      brigade_id: "team-mpvbwqze-a8qj0",
      position: 2,
      balance: 300,
    });
    const groups = accountOrderGroups({
      accounts: [ghost, ...FIXTURE, archivedCash, archivedCard],
      teams: [...TEAMS, { id: "t-old", name: "Команда 2", color: null, is_active: false }],
    });
    assert.deepEqual(
      groups.slice(TEAMS.length).map((g) => [g.key, g.title, ids(g.accounts)]),
      [
        // Осиротевшие — после всех живых, в порядке своих счетов.
        ["t-old", "Команда 2 · в архиве", ["old-card", "old-cash"]],
        ["team-mpvbwqze-a8qj0", "Команда удалена", ["ghost-cash"]],
        [NO_TEAM, "Без команды", ["revolut"]],
      ],
    );
  });

  test("архивная команда без открытых счетов группы не рождает", () => {
    const groups = accountOrderGroups({
      accounts: [account({ id: "yura-cash", name: "Наличные", balance: 1000 })],
      teams: [...TEAMS, { id: "t-old", name: "Дима", color: null, is_active: false }],
    });
    // И живые команды без счетов — тоже: двигать там нечего.
    assert.deepEqual(groups.map((g) => g.key), ["t-yura"]);
  });

  test("одна команда у компании — без заголовка; архивная своё имя держит", () => {
    const only = accountOrderGroups({
      accounts: [account({ id: "yura-cash", name: "Наличные", balance: 1 })],
      // Архивная команда без открытых счетов не делает команд «больше одной».
      teams: [TEAMS[0], { id: "t-old", name: "Дима", color: null, is_active: false }],
    });
    assert.equal(only.length, 1);
    assert.equal(only[0].title, null);

    const orphanOnly = accountOrderGroups({
      accounts: [account({ id: "a", name: "Касса", brigade_id: "team-gone", balance: 900 })],
      teams: [],
    });
    assert.deepEqual(
      orphanOnly.map((g) => [g.key, g.title]),
      [["team-gone", "Команда удалена"]],
    );
  });

  test("команд больше одной — имя стоит и над единственной группой", () => {
    // У второй команды счетов нет, но без имени не видно, чьи это счета.
    const groups = accountOrderGroups({
      accounts: [account({ id: "yura-cash", name: "Наличные", balance: 1 })],
      teams: TEAMS,
    });
    assert.deepEqual(groups.map((g) => [g.key, g.title]), [["t-yura", "Юра"]]);
  });

  test("нет открытых счетов — нет групп", () => {
    assert.deepEqual(accountOrderGroups({ accounts: [], teams: TEAMS }), []);
  });
});

describe("адрес счетов на «Финансах»", () => {
  test("команда уходит параметром, без неё — просто разрез «Счета»", () => {
    assert.equal(financeAccountsHref("t-yura"), "/finances?view=accounts&team=t-yura");
    assert.equal(financeAccountsHref(null), "/finances?view=accounts");
    assert.equal(financeAccountsHref(undefined), "/finances?view=accounts");
    assert.equal(financeAccountsHref(""), "/finances?view=accounts");
  });

  test("id команды экранируется: «&» в id не рвёт адрес", () => {
    assert.equal(
      financeAccountsHref("a&view=documents"),
      "/finances?view=accounts&team=a%26view%3Ddocuments",
    );
  });
});

describe("подпись двери «Счета»", () => {
  test("числа открытых и закрытых, ноль — словом, неизвестное не выдумываем", () => {
    assert.equal(accountsDoorLine(2, 0), "2 счёта · закрытых нет");
    assert.equal(accountsDoorLine(5, 3), "5 счетов · закрытых 3");
    assert.equal(accountsDoorLine(0, 1), "Открытых нет · закрытых 1");
    assert.equal(accountsDoorLine(undefined, 0), "Остатки, порядок, закрытые");
    assert.equal(accountsDoorLine(2, undefined), "Остатки, порядок, закрытые");
  });

  test("строка «Закрытые счета» за дверью пишет то же число тем же словом", () => {
    assert.equal(closedCountValue(2), "2");
    assert.equal(closedCountValue(0), "нет");
    assert.ok(accountsDoorLine(4, 2).endsWith(closedCountValue(2)));
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
