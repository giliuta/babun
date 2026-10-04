import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { DEFAULT_SORT, SORT_LABELS_LONG, SORT_ORDER, sortClients } from "./filter";

function client(id: string, patch: Partial<Client> = {}): Client {
  return {
    ...createBlankClient({ id, full_name: id }),
    created_at: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

function stats(patch: Partial<ClientStats> = {}): ClientStats {
  return {
    visits: 0,
    totalSpent: 0,
    lastVisitDate: "",
    lastVisitDays: null,
    medianGapDays: null,
    unclosedVisits: 0,
    lastUnclosedDate: "",
    nextApt: null,
    nextAptDays: null,
    debt: 0,
    expectedRevenue: 0,
    lastTeamId: null,
    ageDays: 0,
    birthdayInDays: null,
    ...patch,
  };
}

const ids = (list: Client[]) => list.map((c) => c.id);

describe("sortClients", () => {
  // Клиент БЕЗ визитов больше не всплывает выше обслуженного: раньше
  // фолбэк на created_at сравнивал ISO-время с голой датой.
  test("«Недавний визит»: свежие сверху, без визитов — в хвост", () => {
    const list = [
      client("нет-визитов", { created_at: "2026-07-25T10:00:00Z" }),
      client("старый"),
      client("свежий"),
    ];
    const map = new Map([
      ["старый", stats({ lastVisitDate: "2026-05-01" })],
      ["свежий", stats({ lastVisitDate: "2026-07-25" })],
    ]);
    assert.deepEqual(ids(sortClients(list, map, "recent")), [
      "свежий",
      "старый",
      "нет-визитов",
    ]);
  });

  // Главная новая ось: «кто пропал дольше всех» для списка на дозвон.
  test("«Недавний визит» сортирует по дате из строки — незакрытый визит тоже (повторный аудит 03.10)", () => {
    const list = [client("a"), client("b"), client("c"), client("d")];
    const map = new Map<string, ClientStats>([
      // Закрыт 1 сен, потом незакрытый 28 сен — строка печатает «28 сен».
      ["a", stats({ lastVisitDate: "2026-09-01", lastUnclosedDate: "2026-09-28" })],
      ["b", stats({ lastVisitDate: "2026-09-15" })],
      // Только незакрытый визит — дата в строке есть, значит не хвост.
      ["c", stats({ lastUnclosedDate: "2026-09-10" })],
      // Только будущая запись — визитом не считается.
      ["d", stats({ nextApt: { date: "2026-10-10" } as ClientStats["nextApt"] })],
    ]);
    assert.deepEqual(ids(sortClients(list, map, "recent")), ["a", "b", "c", "d"]);
  });

  test("«Давний визит»: переворачивает только визиты, хвост остаётся внизу", () => {
    const list = [client("свежий"), client("нет-визитов"), client("старый")];
    const map = new Map([
      ["свежий", stats({ lastVisitDate: "2026-07-25" })],
      ["старый", stats({ lastVisitDate: "2026-05-01" })],
    ]);
    assert.deepEqual(ids(sortClients(list, map, "stale")), [
      "старый",
      "свежий",
      "нет-визитов",
    ]);
  });

  test("«Самый большой долг»: считает ТОЛЬКО недоплату по визитам", () => {
    // Легаси-колонка `balance` больше не долг (владелец 2026-08-07): её никто
    // не считает и не даёт править, а она поднимала наверх списка человека,
    // которому не сделали ни одной работы.
    const list = [
      client("без-долга"),
      client("баланс-минус", { balance: -300 }),
      client("долг-по-визитам"),
    ];
    const map = new Map([["долг-по-визитам", stats({ debt: 100 })]]);
    const sorted = ids(sortClients(list, map, "debt"));
    assert.equal(sorted[0], "долг-по-визитам");
    assert.equal(sorted.includes("баланс-минус"), true);
  });

  test("закрепление больше не поднимает клиента (владелец 03.10)", () => {
    const list = [
      client("обычный-свежий"),
      client("пин-старый", { pinned_at: "2026-07-01T00:00:00Z" }),
      client("пин-свежий", { pinned_at: "2026-07-02T00:00:00Z" }),
    ];
    const map = new Map([
      ["обычный-свежий", stats({ lastVisitDate: "2026-07-25" })],
      ["пин-старый", stats({ lastVisitDate: "2026-01-01" })],
      ["пин-свежий", stats({ lastVisitDate: "2026-07-20" })],
    ]);
    assert.deepEqual(ids(sortClients(list, map, "recent")), [
      "обычный-свежий",
      "пин-свежий",
      "пин-старый",
    ]);
  });

  test("по умолчанию — по алфавиту, и он первый в выборе", () => {
    assert.equal(DEFAULT_SORT, "name");
    assert.equal(SORT_ORDER[0], "name");
    assert.equal(SORT_LABELS_LONG.name, "По алфавиту");
  });

  test("порядок детерминирован при полностью равных значениях", () => {
    const list = [client("б"), client("а"), client("в")];
    const map = new Map<string, ClientStats>();
    const once = ids(sortClients(list, map, "revenue"));
    const twice = ids(sortClients([...list].reverse(), map, "revenue"));
    assert.deepEqual(once, twice);
    assert.deepEqual(once, ["а", "б", "в"]); // тай-брейк по имени
  });
});
