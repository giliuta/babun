import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankClient, type Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { sortClients } from "./filter";

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

  test("«Самый большой долг»: считает и отрицательный баланс карточки", () => {
    const list = [
      client("без-долга"),
      client("баланс-минус", { balance: -300 }),
      client("долг-по-визитам"),
    ];
    const map = new Map([["долг-по-визитам", stats({ debt: 100 })]]);
    assert.deepEqual(ids(sortClients(list, map, "debt")), [
      "баланс-минус",
      "долг-по-визитам",
      "без-долга",
    ]);
  });

  test("закреплённые сверху, внутри — тот же компаратор", () => {
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
      "пин-свежий",
      "пин-старый",
      "обычный-свежий",
    ]);
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
