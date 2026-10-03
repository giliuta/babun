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

describe("адрес и метка из файла (аудит 03.10)", () => {
  const base = {
    source: 3,
    full_name: "Мария",
    phone: "+35799123457",
    rawPhone: "99 123 457",
    email: "",
    city: "",
    address: "",
    comment: "",
    reasons: [],
  };

  test("адрес становится объектом клиента, а не старым полем", () => {
    const client = rowToClient({ ...base, address: " Agias Fylaxeos 10 " }, "CY");
    assert.equal(client.address, "");
    assert.equal(client.locations.length, 1);
    assert.equal(client.locations[0]?.address, "Agias Fylaxeos 10");
    assert.equal(client.locations[0]?.isPrimary, true);
  });

  test("без адреса объекта нет", () => {
    assert.deepEqual(rowToClient(base, "CY").locations, []);
  });

  test("метка из файла — ручная: авто-метка её не перепишет", () => {
    const client = rowToClient({ ...base, city: "Лимассол" }, "CY");
    assert.equal(client.city, "Лимассол");
    assert.equal(client.city_manual, true);
    assert.equal(rowToClient(base, "CY").city_manual, undefined);
  });
});
