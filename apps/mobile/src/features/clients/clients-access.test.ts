import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "@/features/access/access-map";
import { clientsAccessOf } from "./clients-access";

const mapWith = (
  calendars: MemberAccessMap["calendars"],
  company: MemberAccessMap["company"] = {},
): MemberAccessMap =>
  ({ tenantId: "t", isOwner: false, company, calendars, attachedCalendars: Object.keys(calendars) }) as unknown as MemberAccessMap;

describe("права клиентов — из команд", () => {
  test("видит в одной команде, не видит в другой — видит; свои; номер — по блоку «Клиент» (02.10)", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.scope": "own", "clients.client": "read" },
        B: { clients: "off" },
      }),
    );
    assert.deepEqual(got, { clients: "read", scope: "own", contacts: "read", create: "off" });
  });

  test("меняет хоть в одной — меняет; «все» и телефоны из команды, где видит", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.scope": "all", "clients.client": "read" },
        B: { clients: "write" },
      }),
    );
    assert.deepEqual(got, { clients: "write", scope: "all", contacts: "read", create: "off" });
  });

  test("«все» в команде, где клиенты закрыты, не считается", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "off", "clients.scope": "all", "clients.client": "write" },
        B: { clients: "read", "clients.scope": "own", "clients.client": "read" },
      }),
    );
    assert.deepEqual(got, { clients: "read", scope: "own", contacts: "read", create: "off" });
  });

  test("защита базы: без строки — «Неделя»; берётся самое широкое; без базы номера нет", () => {
    // Без строки «Клиент» — скрыт: номера нет.
    assert.deepEqual(clientsAccessOf(mapWith({ A: { clients: "read" } })), {
      clients: "read",
      scope: "week",
      contacts: "off",
      create: "off",
    });
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.scope": "near" },
        B: { clients: "read", "clients.scope": "month", "clients.client": "read" },
      }),
    );
    assert.deepEqual(got, { clients: "read", scope: "month", contacts: "read", create: "off" });
    assert.deepEqual(clientsAccessOf(mapWith({ A: { clients: "off" } })), {
      clients: "off",
      scope: "week",
      contacts: "off",
      create: "off",
    });
  });

  test("старый сервер — права на компанию читаются как были", () => {
    const got = clientsAccessOf(mapWith({}, { clients: "read", "clients.scope": "all", "clients.client": "read" }));
    assert.deepEqual(got, { clients: "read", scope: "all", contacts: "read", create: "off" });
  });

  test("«Создание клиента» — «Может» хоть в одной команде, где он видит клиентов (02.10)", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.create": "write" },
        B: { clients: "off", "clients.create": "write" },
      }),
    );
    assert.equal(got.create, "write");
    assert.equal(clientsAccessOf(mapWith({ A: { clients: "read" } })).create, "off");
  });

  test("ни одной строки клиентов — прав нет", () => {
    assert.deepEqual(clientsAccessOf(mapWith({ A: { "record.team": "read" } })), {});
  });
});
