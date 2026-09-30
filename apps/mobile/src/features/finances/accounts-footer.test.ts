import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountsFooterAction } from "./accounts-footer";

const CASH = { id: "cash" };
const CARD = { id: "card" };
const OTHER_TEAM = { id: "other-team-cash" };

describe("accountsFooterAction", () => {
  test("у компании нет счетов — «Добавить счёт»", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: null, shown: [], company: [] }),
      { kind: "create" },
    );
  });

  test("у команды чипа нет ни одного счёта — «Добавить счёт», даже если у других команд есть", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: null, shown: [], company: [CASH, OTHER_TEAM] }),
      { kind: "create" },
    );
  });

  test("единственный счёт компании — кнопка перевода, но переводить некуда", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: "cash", shown: [CASH], company: [CASH] }),
      { kind: "needs-second" },
    );
  });

  test("два счёта без выбора — перевод, источник выберут в шторке", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: null, shown: [CASH, CARD], company: [CASH, CARD] }),
      { kind: "transfer", fromId: null },
    );
  });

  test("выбрана плитка — перевод С ЭТОГО счёта", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: "card", shown: [CASH, CARD], company: [CASH, CARD] }),
      { kind: "transfer", fromId: "card" },
    );
  });

  test("второй счёт в другой команде тоже годится: деньги ходят между командами", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: "cash", shown: [CASH], company: [CASH, OTHER_TEAM] }),
      { kind: "transfer", fromId: "cash" },
    );
  });

  test("выбранного счёта нет на плитках — перевода с невидимого нет", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: "other-team-cash", shown: [CASH], company: [CASH, OTHER_TEAM, CARD] }),
      { kind: "transfer", fromId: null },
    );
  });

  test("выбранный счёт закрыт, а плитки ещё не перечитались — источник не пресетится", () => {
    assert.deepEqual(
      accountsFooterAction({ selectedId: "card", shown: [CASH, CARD], company: [CASH, OTHER_TEAM] }),
      { kind: "transfer", fromId: null },
    );
  });
});
