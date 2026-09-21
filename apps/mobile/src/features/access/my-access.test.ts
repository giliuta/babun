import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MemberAccessMap } from "./access-map";
import {
  accessGate,
  bestCalendarLevel,
  FINANCE_BLOCK_KEYS,
  isFinanceDataKey,
  isNewerAccess,
  lostAccess,
} from "./my-access";

describe("деньги, которые стираются при понижении", () => {
  const T = "tenant-1";

  test("ключи денег этой компании — да; другой компании и не денег — нет", () => {
    assert.equal(isFinanceDataKey(["transactions", T, "2026-09-01", "2026-09-30", null, null], T), true);
    assert.equal(isFinanceDataKey(["debts", T, "paid-totals"], T), true);
    assert.equal(isFinanceDataKey(["accounts", T, "balances"], T), true);
    assert.equal(isFinanceDataKey(["day-extras", T, "master"], T), true);
    assert.equal(isFinanceDataKey(["transfer-counterpart", T, "group-1"], T), true);
    assert.equal(isFinanceDataKey(["appointment-ledger", T, "appt-1"], T), true);
    assert.equal(isFinanceDataKey(["transactions", "tenant-2", "x"], T), false);
    assert.equal(isFinanceDataKey(["appointments", T, "master"], T), false);
    assert.equal(isFinanceDataKey(["my-access", T], T), false);
  });

  test("все блоки финансов в списке понижения", () => {
    for (const key of [
      "finance.operations",
      "finance.accounts",
      "finance.debts",
      "finance.documents",
      "finance.categories",
      "finance.templates",
      "finance.vat",
    ]) {
      assert.ok(FINANCE_BLOCK_KEYS.includes(key), key);
    }
  });
});

const map = (over: Partial<MemberAccessMap> = {}): MemberAccessMap => ({
  tenantId: "tenant-1",
  isOwner: false,
  version: 7,
  company: {},
  calendars: {},
  attachedCalendars: [],
  ...over,
});

const OPS = "finance.operations";

describe("ворота блока", () => {
  test("владелец меняет всё и не ждёт карту", () => {
    assert.equal(accessGate({ role: "owner", map: undefined, blockKey: OPS, scope: "calendar" }), "write");
  });

  test("роль или карта ещё едут — ждать, а не «скрыт»", () => {
    assert.equal(accessGate({ role: undefined, map: map(), blockKey: OPS, scope: "calendar" }), "loading");
    assert.equal(accessGate({ role: "master", map: undefined, blockKey: OPS, scope: "calendar" }), "loading");
  });

  test("человека в компании нет — граница, а не серая страница", () => {
    assert.equal(accessGate({ role: null, map: map(), blockKey: OPS, scope: "calendar" }), "gone");
  });

  test("календарный блок читается по своему календарю", () => {
    const m = map({ calendars: { "team-1": { [OPS]: "write" }, "team-2": { [OPS]: "read" } } });
    const at = (teamId: string) =>
      accessGate({ role: "master", map: m, blockKey: OPS, scope: "calendar", teamId });
    assert.equal(at("team-1"), "write");
    assert.equal(at("team-2"), "read");
    assert.equal(at("team-3"), "locked");
  });

  test("без календаря — лучший по всем; нигде нет — скрыт", () => {
    const m = map({ calendars: { "team-1": { [OPS]: "read" }, "team-2": { [OPS]: "off" } } });
    assert.equal(accessGate({ role: "master", map: m, blockKey: OPS, scope: "calendar" }), "read");
    assert.equal(accessGate({ role: "master", map: map(), blockKey: OPS, scope: "calendar" }), "locked");
  });

  test("блок компании читается из компании, не из календарей", () => {
    const m = map({ company: { "finance.categories": "read" }, calendars: { "team-1": { "finance.categories": "write" } } });
    assert.equal(
      accessGate({ role: "dispatcher", map: m, blockKey: "finance.categories", scope: "company" }),
      "read",
    );
  });

  test("охват «Все» — не доступ; карта владельца — меняет", () => {
    const m = map({ company: { "clients.scope": "all" } });
    assert.equal(accessGate({ role: "master", map: m, blockKey: "clients.scope", scope: "company" }), "locked");
    assert.equal(
      accessGate({ role: "master", map: map({ isOwner: true }), blockKey: OPS, scope: "calendar", teamId: "x" }),
      "write",
    );
  });

  test("лучшее положение по календарям", () => {
    const m = map({ calendars: { a: { [OPS]: "read" }, b: { [OPS]: "write" }, c: {} } });
    assert.equal(bestCalendarLevel(m, OPS), "write");
    assert.equal(bestCalendarLevel(map(), OPS), undefined);
  });
});

describe("сигнал смены прав", () => {
  test("перечитывать только новее того, что есть", () => {
    assert.equal(isNewerAccess(8, map({ version: 7 })), true);
    assert.equal(isNewerAccess(7, map({ version: 7 })), false);
    assert.equal(isNewerAccess(6, map({ version: 7 })), false);
    assert.equal(isNewerAccess("8", map({ version: 7 })), false);
    assert.equal(isNewerAccess(undefined, undefined), true);
  });

  test("понижение в любом календаре или в компании — стирать данные", () => {
    const before = map({
      company: { "finance.categories": "write" },
      calendars: { "team-1": { [OPS]: "write" }, "team-2": { [OPS]: "read" } },
    });
    const keys = [OPS, "finance.categories"];
    assert.equal(
      lostAccess(before, map({ ...before, calendars: { ...before.calendars, "team-1": { [OPS]: "read" } } }), keys),
      true,
    );
    assert.equal(lostAccess(before, map({ ...before, calendars: { "team-1": { [OPS]: "write" } } }), keys), true);
    assert.equal(lostAccess(before, map({ ...before, company: {} }), keys), true);
    assert.equal(lostAccess(map({ isOwner: true }), before, keys), true);
  });

  test("повышение и чужие блоки — не понижение", () => {
    const before = map({ calendars: { "team-1": { [OPS]: "read" } } });
    assert.equal(lostAccess(before, map({ calendars: { "team-1": { [OPS]: "write" } } }), [OPS]), false);
    assert.equal(
      lostAccess(before, map({ calendars: { "team-1": { [OPS]: "read", "calendar.records": "off" } } }), [OPS]),
      false,
    );
    assert.equal(lostAccess(undefined, before, [OPS]), false);
  });
});
