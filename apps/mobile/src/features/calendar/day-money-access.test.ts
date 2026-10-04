import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MemberAccessMap } from "@/features/access/access-map";
import {
  canEditDayMoneyRow,
  dayMoneyGate,
  dayMoneyRowReadable,
  isDayMoneyRow,
} from "./day-money-access";

// ДОХОД И РАСХОД ДНЯ — ПРАВО КАЛЕНДАРЯ (владелец 04.10). Копия правил
// сервера (`finance_transactions_*_day_money`, окно — «Ограничения»
// календаря): в зеркале токен владельца, и строки режутся только здесь.

const TODAY = "2026-10-04";
const ME = "u-partner";

const map = (levels: Record<string, string>, team = "t1"): MemberAccessMap =>
  ({
    tenantId: "ten",
    isOwner: false,
    version: 1,
    company: {},
    calendars: { [team]: levels },
    attachedCalendars: [team],
  }) as MemberAccessMap;

describe("что считается деньгами дня", () => {
  test("оплата записи и операция из календаря — да, касса «Финансов» — нет", () => {
    assert.equal(isDayMoneyRow({ appointment_id: "a1" }), true);
    assert.equal(isDayMoneyRow({ appointment_id: null, from_calendar: true }), true);
    assert.equal(isDayMoneyRow({ appointment_id: null, from_calendar: false }), false);
    assert.equal(isDayMoneyRow({ appointment_id: null }), false);
  });
});

describe("кто видит", () => {
  const row = { team_id: "t1", occurred_on: TODAY };

  test("владелец — всё", () => {
    assert.equal(dayMoneyRowReadable({ role: "owner", map: undefined, today: TODAY })(row), true);
  });

  test("партнёр без права — ничего; права «Финансов» его не открывают", () => {
    const m = map({ "calendar.day_money": "off", "finance.income": "full", "finance.expense": "full" });
    assert.equal(dayMoneyRowReadable({ role: "master", map: m, today: TODAY })(row), false);
    assert.equal(dayMoneyGate({ role: "master", map: m, teamId: "t1" }), "locked");
  });

  test("«Видит» — строки своего календаря, чужой — нет", () => {
    const m = map({ "calendar.day_money": "read" });
    const readable = dayMoneyRowReadable({ role: "master", map: m, today: TODAY });
    assert.equal(readable(row), true);
    assert.equal(readable({ team_id: "t2", occurred_on: TODAY }), false);
  });

  test("«Ограничения» календаря режут старые деньги дня", () => {
    const m = map({ "calendar.day_money": "read", "calendar.window": "week" });
    const readable = dayMoneyRowReadable({ role: "master", map: m, today: TODAY });
    assert.equal(readable({ team_id: "t1", occurred_on: "2026-09-27" }), true);
    assert.equal(readable({ team_id: "t1", occurred_on: "2026-09-26" }), false);
    const open = map({ "calendar.day_money": "read", "calendar.window": "own" });
    assert.equal(
      dayMoneyRowReadable({ role: "master", map: open, today: TODAY })({ team_id: "t1", occurred_on: "2026-01-01" }),
      true,
    );
  });
});

describe("кто правит", () => {
  const base = { teamId: "t1", createdBy: ME, me: ME, fromCalendar: true };

  test("«Вносит» — свою операцию из календаря", () => {
    const m = map({ "calendar.day_money": "write" });
    assert.equal(canEditDayMoneyRow({ role: "master", map: m, ...base }), true);
  });

  test("чужую, из «Финансов» и при «Видит» — нет", () => {
    const write = map({ "calendar.day_money": "write" });
    assert.equal(canEditDayMoneyRow({ role: "master", map: write, ...base, createdBy: "owner" }), false);
    assert.equal(canEditDayMoneyRow({ role: "master", map: write, ...base, fromCalendar: false }), false);
    const read = map({ "calendar.day_money": "read" });
    assert.equal(canEditDayMoneyRow({ role: "master", map: read, ...base }), false);
  });

  test("владелец — любую", () => {
    assert.equal(
      canEditDayMoneyRow({ role: "owner", map: undefined, ...base, createdBy: "x", fromCalendar: false }),
      true,
    );
  });
});
