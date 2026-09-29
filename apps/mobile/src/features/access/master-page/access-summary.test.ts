import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CALENDAR_GROUPS, inGroup, orderGroupRows } from "./access-summary";

describe("разделы прав команды", () => {
  test("раздел — по началу ключа; «clients» берёт и сам блок", () => {
    assert.equal(inGroup("clients", "clients"), true);
    assert.equal(inGroup("clients.scope", "clients"), true);
    assert.equal(inGroup("calendar.create", "record"), false);
    assert.deepEqual(CALENDAR_GROUPS, ["calendar", "record", "finance", "clients"]);
  });

  test("права записи — в порядке страницы записи", () => {
    const rows = ["record.status", "record.amount", "record.client", "record.services", "record.team"].map(
      (key) => ({ block: { key } }),
    );
    assert.deepEqual(
      orderGroupRows("record", rows).map((row) => row.block.key),
      ["record.team", "record.client", "record.services", "record.amount", "record.status"],
    );
    assert.deepEqual(orderGroupRows("finance", rows), rows);
  });
});
