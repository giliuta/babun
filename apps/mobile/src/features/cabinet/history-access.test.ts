import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { MemberAccessMap } from "@/features/access/access-map";
import { HISTORY_ENTITY_RIGHTS, historyRowVisible } from "./history-access";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» ПАРТНЁРА (владелец 04.10). Таблица соответствий живёт
// дважды — в политике сервера и здесь, для «его глазами»; разъедутся — в
// зеркале партнёр увидит не то, что увидит на самом деле.

const MIGRATION = join(
  __dirname,
  "../../../../../supabase/migrations/20261004082634_cabinet_history_right.sql",
);

describe("таблица журнала — та же, что в политике сервера", () => {
  test("каждая таблица и её права совпадают с миграцией", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const fromSql: Record<string, string[]> = {};
    for (const line of sql.split("\n")) {
      const when = line.match(/when '([a-z_]+)' then (.*)$/);
      if (!when) continue;
      fromSql[when[1]] = [...when[2].matchAll(/access_calendars\('([a-z_.]+)', 'read'\)/g)]
        .map((m) => m[1])
        .sort();
    }
    const fromApp = Object.fromEntries(
      Object.entries(HISTORY_ENTITY_RIGHTS).map(([entity, keys]) => [entity, [...keys].sort()]),
    );
    assert.deepEqual(fromApp, fromSql);
  });
});

const map = (company: Record<string, string>, team: Record<string, string>): MemberAccessMap =>
  ({
    tenantId: "ten",
    isOwner: false,
    version: 1,
    company,
    calendars: { t1: team },
    attachedCalendars: ["t1"],
  }) as MemberAccessMap;

describe("что из журнала видит партнёр", () => {
  const record = { team_id: "t1", entity: "appointments" };

  test("без права «История изменений» — ничего", () => {
    assert.equal(historyRowVisible(record, map({}, { "calendar.records": "write" })), false);
  });

  test("с правом — записи своей команды, если видит «Записи клиентов»", () => {
    const m = map({ "cabinet.history": "read" }, { "calendar.records": "read" });
    assert.equal(historyRowVisible(record, m), true);
    assert.equal(historyRowVisible({ team_id: "t2", entity: "appointments" }, m), false);
  });

  test("операции — только при видимых доходах или расходах", () => {
    const tx = { team_id: "t1", entity: "finance_transactions" };
    assert.equal(historyRowVisible(tx, map({ "cabinet.history": "read" }, { "finance.income": "off" })), false);
    assert.equal(historyRowVisible(tx, map({ "cabinet.history": "read" }, { "finance.expense": "read" })), true);
  });

  test("права людей, реквизиты и строки без команды — только владельцу", () => {
    const m = map({ "cabinet.history": "read" }, { "calendar.records": "write" });
    assert.equal(historyRowVisible({ team_id: "t1", entity: "member_access" }, m), false);
    assert.equal(historyRowVisible({ team_id: null, entity: "legal_entities" }, m), false);
    assert.equal(historyRowVisible({ team_id: "t1", entity: "member_access" }, { ...m, isOwner: true }), true);
  });
});
