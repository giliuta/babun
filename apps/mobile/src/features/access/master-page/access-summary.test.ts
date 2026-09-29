import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AccessBlock, AccessLevel } from "../access-map";
import { calendarGroupLine, groupBlocks, orderGroupRows } from "./access-summary";
import { blankMasterDraft, type MasterDraft } from "./master-draft";

const block = (key: string, levels: AccessLevel[], live = true): AccessBlock => ({
  key,
  area: key.startsWith("finance.") ? "finance" : "calendar",
  scope: "calendar",
  levels,
  title: key,
  ownerOnly: false,
  live,
  position: 0,
});

const REGISTRY: AccessBlock[] = [
  block("calendar.records", ["off", "read", "write"], false),
  block("calendar.create", ["off", "write"]),
  block("calendar.events", ["off", "read", "write"]),
  block("record.status", ["read", "write"]),
  block("record.client", ["off", "read", "write"]),
  block("record.services", ["off", "read"]),
  block("record.amount", ["off", "read", "write"]),
  block("finance.operations", ["off", "read", "write"]),
  block("finance.debts", ["off", "read", "write"]),
];

const draftWith = (levels: Record<string, AccessLevel>): MasterDraft => ({
  ...blankMasterDraft("A"),
  calendarLevels: { A: levels },
});

describe("сводка блока «Доступ» по разделам", () => {
  test("группа — по началу ключа, только живые", () => {
    assert.deepEqual(
      groupBlocks(REGISTRY, "calendar").map((b) => b.key),
      ["calendar.create", "calendar.events"],
    );
    assert.deepEqual(
      groupBlocks(REGISTRY, "finance").map((b) => b.key),
      ["finance.operations", "finance.debts"],
    );
  });

  test("всё закрытое закрыто — «Не видит», даже при вечно видимом статусе", () => {
    const draft = draftWith({ "record.status": "read" });
    assert.equal(calendarGroupLine(REGISTRY, draft, "A", "record"), "Не видит");
    assert.equal(calendarGroupLine(REGISTRY, draft, "A", "finance"), "Не видит");
  });

  test("всё на потолке — «Меняет»; услуги с потолком «Видит» не мешают", () => {
    const draft = draftWith({
      "record.status": "write",
      "record.client": "write",
      "record.services": "read",
      "record.amount": "write",
    });
    assert.equal(calendarGroupLine(REGISTRY, draft, "A", "record"), "Меняет");
  });

  test("закрыто одно-два — называет их", () => {
    const draft = draftWith({
      "record.status": "read",
      "record.services": "read",
      "record.amount": "off",
      "record.client": "off",
    });
    assert.equal(calendarGroupLine(REGISTRY, draft, "A", "record"), "Без клиента и цен");
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

  test("всё открыто, меняет не всё — «Видит, меняет часть»", () => {
    const draft = draftWith({ "finance.operations": "write", "finance.debts": "read" });
    assert.equal(calendarGroupLine(REGISTRY, draft, "A", "finance"), "Видит, меняет часть");
  });
});
