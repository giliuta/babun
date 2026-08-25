import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importClientId, rowToClient } from "./import-client";

describe("CSV import client projection", () => {
  test("always stamps a Postgres-compatible UUID on Hermes", () => {
    const client = rowToClient(
      {
        source: 2,
        full_name: "Иван",
        phone: "+35799123456",
        rawPhone: "+35799123456",
        email: "",
        city: "Лимассол",
        address: "",
        comment: "",
        reasons: [],
      },
      "CY",
      "tag-vip",
    );

    assert.match(
      client.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.deepEqual(client.tag_ids, ["tag-vip"]);
  });

  test("uses a stable UUID per tenant, file and source row", () => {
    const first = importClientId(
      "11111111-1111-1111-1111-111111111111",
      "file-hash",
      42,
    );
    assert.equal(
      first,
      importClientId(
        "11111111-1111-1111-1111-111111111111",
        "file-hash",
        42,
      ),
    );
    assert.match(
      first,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.notEqual(importClientId("tenant-b", "file-hash", 42), first);
    assert.notEqual(
      importClientId("11111111-1111-1111-1111-111111111111", "file-hash", 43),
      first,
    );
  });
});
