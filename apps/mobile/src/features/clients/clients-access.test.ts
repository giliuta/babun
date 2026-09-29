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
  test("видит в одной команде, не видит в другой — видит; свои; без телефонов", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.scope": "own", "clients.contacts": "off" },
        B: { clients: "off" },
      }),
    );
    assert.deepEqual(got, { clients: "read", scope: "own", contacts: "off" });
  });

  test("меняет хоть в одной — меняет; «все» и телефоны из команды, где видит", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "read", "clients.scope": "all", "clients.contacts": "read" },
        B: { clients: "write" },
      }),
    );
    assert.deepEqual(got, { clients: "write", scope: "all", contacts: "read" });
  });

  test("«все» в команде, где клиенты закрыты, не считается", () => {
    const got = clientsAccessOf(
      mapWith({
        A: { clients: "off", "clients.scope": "all", "clients.contacts": "read" },
        B: { clients: "read" },
      }),
    );
    assert.deepEqual(got, { clients: "read", scope: "own", contacts: "off" });
  });

  test("старый сервер — права на компанию читаются как были", () => {
    const got = clientsAccessOf(mapWith({}, { clients: "read", "clients.scope": "all", "clients.contacts": "read" }));
    assert.deepEqual(got, { clients: "read", scope: "all", contacts: "read" });
  });

  test("ни одной строки клиентов — прав нет", () => {
    assert.deepEqual(clientsAccessOf(mapWith({ A: { "record.team": "read" } })), {});
  });
});
