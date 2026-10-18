import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client, Location } from "@babun/shared/local/clients";
import { eventLocationRows, withAddedLocation } from "./event-locations";

const loc = (id: string): Location => ({ id, label: id, address: `${id} street`, isPrimary: false });
const client = (id: string, name: string, locations?: Location[]) =>
  ({ id, full_name: name, locations }) as Client;

describe("withAddedLocation", () => {
  const server = [loc("a")];

  test("adds the just-created object until the server returns it", () => {
    const c = client("c1", "Анна", server);
    const added = { clientId: "c1", loc: loc("new") };
    assert.deepEqual(withAddedLocation(c, server, added).map((l) => l.id), ["a", "new"]);
    const arrived = [loc("a"), loc("new")];
    assert.equal(withAddedLocation(c, arrived, added), arrived);
  });

  test("never gives one client's new object to another", () => {
    const other = client("c2", "Борис", server);
    assert.equal(withAddedLocation(other, server, { clientId: "c1", loc: loc("new") }), server);
    assert.equal(withAddedLocation(null, server, { clientId: "c1", loc: loc("new") }), server);
  });
});

describe("eventLocationRows", () => {
  test("objects of all clients with their owner; the form's client uses its fresh list", () => {
    const anna = client("c1", "Анна", [loc("a")]);
    const nameless = client("c2", "", [loc("b")]);
    const none = client("c3", "Вера");
    const rows = eventLocationRows([anna, nameless, none], anna, [loc("a"), loc("fresh")]);
    assert.deepEqual(
      rows.map((r) => [r.loc.id, r.ownerId, r.ownerName]),
      [
        ["a", "c1", "Анна"],
        ["fresh", "c1", "Анна"],
        ["b", "c2", "Без имени"],
      ],
    );
  });
});
