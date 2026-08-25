import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountOwnerLabel,
  defaultTransferTarget,
  transferGroups,
  type TransferAccount,
} from "./transfer-options";

function account(
  patch: Partial<TransferAccount> & { id: string },
): TransferAccount {
  return {
    scope: "team",
    brigade_id: "t-yura",
    team_ids: [],
    name: patch.id,
    kind: "cash",
    position: 0,
    balance: 0,
    is_active: true,
    ...patch,
  };
}

const TEAMS = [
  { id: "t-yura", name: "Юра" },
  { id: "t-dima", name: "Дима" },
];
const teamName = (id: string | null) =>
  id ? (TEAMS.find((t) => t.id === id)?.name ?? null) : null;

const YURA_CASH = account({ id: "yura-cash", name: "Наличные", balance: 640 });
const YURA_CARD = account({
  id: "yura-card",
  name: "Карта",
  kind: "card",
  position: 1,
  balance: 410,
});
const DIMA_CASH = account({
  id: "dima-cash",
  name: "Наличные",
  brigade_id: "t-dima",
  balance: 800,
});
/** Наследие общего счёта: владельца в строке нет. Перенести его в базе не дал
 *  сторож истории денег, поэтому клиент обязан уметь его показать. */
const ORPHAN = account({
  id: "orphan",
  name: "Revolut",
  brigade_id: null,
  kind: "bank",
  balance: 5120,
});

const ALL = [YURA_CASH, YURA_CARD, DIMA_CASH, ORPHAN];

describe("accountOwnerLabel — полное имя там, где нет заголовка", () => {
  test("счёт называет свою команду", () => {
    assert.equal(accountOwnerLabel(YURA_CASH, teamName), "Наличные · Юра");
    assert.equal(accountOwnerLabel(DIMA_CASH, teamName), "Наличные · Дима");
  });

  test("удалённая команда и отсутствие команды — разные вещи, и обе названы", () => {
    assert.equal(
      accountOwnerLabel(
        account({ id: "x", name: "Касса", brigade_id: "gone" }),
        teamName,
      ),
      "Касса · Команда удалена",
    );
    assert.equal(accountOwnerLabel(ORPHAN, teamName), "Revolut · Без команды");
  });
});

describe("transferGroups — сначала команда, потом её счета", () => {
  test("команда источника идёт первой, ничьи счета — в хвосте", () => {
    const groups = transferGroups({
      accounts: ALL,
      from: null,
      teams: TEAMS,
      ownTeamId: "t-dima",
    });
    assert.deepEqual(
      groups.map((g) => g.title),
      ["Дима", "Юра", "Без команды"],
    );
    assert.deepEqual(
      groups[0].accounts.map((a) => a.id),
      ["dima-cash"],
    );
    // Внутри группы порядок общий с экраном счетов: наличные раньше карты.
    assert.deepEqual(
      groups[1].accounts.map((a) => a.id),
      ["yura-cash", "yura-card"],
    );
  });

  test("выбранный источник в список получателей не попадает", () => {
    const groups = transferGroups({
      accounts: ALL,
      from: YURA_CASH,
      teams: TEAMS,
      ownTeamId: "t-yura",
    });
    const ids = groups.flatMap((g) => g.accounts.map((a) => a.id));
    assert.ok(!ids.includes("yura-cash"));
    // ЛЮБАЯ пара допустима: запрет «между командами только через общий счёт»
    // ушёл вместе с общим счётом.
    assert.ok(ids.includes("dima-cash"));
  });

  test("удалённая команда — своя группа, не «Без команды»", () => {
    const GONE = account({ id: "gone-cash", name: "Касса", brigade_id: "t-gone" });
    const groups = transferGroups({
      accounts: [YURA_CASH, GONE, ORPHAN],
      from: null,
      teams: TEAMS,
      ownTeamId: "t-yura",
    });
    // То же деление, что в accountOwnerLabel: команда есть, но команды нет —
    // «Команда удалена»; совсем без команды — «Без команды».
    assert.deepEqual(
      groups.map((g) => g.title),
      ["Юра", "Команда удалена", "Без команды"],
    );
    assert.deepEqual(
      groups[1].accounts.map((a) => a.id),
      ["gone-cash"],
    );
    // Ключ группы — id удалённой команды: таких групп может быть несколько,
    // и null склеил бы их с осиротевшими.
    assert.equal(groups[1].teamId, "t-gone");
  });

  test("закрытые счета не показываются вовсе", () => {
    const groups = transferGroups({
      accounts: [YURA_CASH, account({ ...YURA_CARD, is_active: false })],
      from: null,
      teams: TEAMS,
      ownTeamId: "t-yura",
    });
    assert.deepEqual(
      groups.flatMap((g) => g.accounts.map((a) => a.id)),
      ["yura-cash"],
    );
  });

  test("пустая группа не рисуется", () => {
    const groups = transferGroups({
      accounts: [YURA_CASH],
      from: null,
      teams: TEAMS,
      ownTeamId: "t-yura",
    });
    assert.deepEqual(
      groups.map((g) => g.title),
      ["Юра"],
    );
  });
});

describe("defaultTransferTarget — только память", () => {
  test("запомненный счёт подставляется", () => {
    assert.equal(
      defaultTransferTarget({
        accounts: ALL,
        from: YURA_CASH,
        remembered: "dima-cash",
      })?.id,
      "dima-cash",
    );
  });

  test("памяти нет, счёт закрыли или это сам источник — подстановки нет", () => {
    assert.equal(
      defaultTransferTarget({
        accounts: ALL,
        from: YURA_CASH,
        remembered: null,
      }),
      null,
    );
    assert.equal(
      defaultTransferTarget({
        accounts: [YURA_CASH, account({ ...DIMA_CASH, is_active: false })],
        from: YURA_CASH,
        remembered: "dima-cash",
      }),
      null,
    );
    assert.equal(
      defaultTransferTarget({
        accounts: ALL,
        from: YURA_CASH,
        remembered: "yura-cash",
      }),
      null,
    );
  });
});
