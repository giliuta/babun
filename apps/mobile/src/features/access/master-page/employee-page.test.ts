import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createInvitationArgs } from "./invitation-contract";
import { monthWorkOf, workLine, workOfPeriod, workWindow } from "./master-work";
import { rightsFocusOf, rightsFocusQuery } from "./rights-focus";

// STORY-087 — страница сотрудника по законам страницы клиента (владелец 23.09).

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

describe("адрес прав → фокус страницы", () => {
  test("календарь, компания, прежняя страница", () => {
    assert.deepEqual(rightsFocusOf("team-1", null), { kind: "calendar", teamId: "team-1" });
    assert.deepEqual(rightsFocusOf("", "company"), { kind: "company" });
    assert.equal(rightsFocusOf(undefined, undefined), undefined);
    assert.equal(rightsFocusQuery({ kind: "calendar", teamId: "a b" }), "calendar=a%20b");
    assert.equal(rightsFocusQuery({ kind: "company" }), "scope=company");
  });
});

describe("работа сотрудника — по его календарям", () => {
  const now = new Date(2026, 8, 23);
  const rows = [
    { date: "2026-09-02", team_id: "A", status: "completed" },
    { date: "2026-09-10", team_id: "A", status: "scheduled" },
    { date: "2026-09-11", team_id: "A", status: "cancelled" },
    { date: "2026-09-12", team_id: "B", status: "completed" },
    { date: "2026-08-30", team_id: "A", status: "completed" },
    { date: "2026-09-13", team_id: "A", status: "scheduled", kind: "event" },
  ];
  test("чужой календарь, отменённые, события и прошлый месяц не считаются", () => {
    assert.deepEqual(monthWorkOf(rows, ["A"], now), { total: 2, done: 1 });
  });
  test("строка сводки", () => {
    assert.equal(workLine({ total: 2, done: 1 }, now), "2 записи в сентябре · 1 выполнено");
    assert.equal(workLine({ total: 5, done: 0 }, now), "5 записей в сентябре");
    assert.equal(workLine({ total: 0, done: 0 }, now), "в сентябре нет");
  });
});

describe("приглашение по карточке без аккаунта", () => {
  const request = {
    email: "a@b.cy",
    fullName: "Ivan",
    phone: null,
    teamIds: ["A"],
    title: "Техник",
    color: "#112233",
    access: [],
  };
  test("с карточкой уходит p_master_id, а должность и цвет — пусто", () => {
    const args = createInvitationArgs({ ...request, masterId: "master-1" });
    assert.equal(args.p_master_id, "master-1");
    assert.equal(args.p_master_title, null);
    assert.equal(args.p_master_color, null);
  });
  test("без карточки — как раньше", () => {
    const args = createInvitationArgs(request);
    assert.equal("p_master_id" in args, false);
    assert.equal(args.p_master_title, "Техник");
  });
});

describe("одна дверь на человека", () => {
  test("карточка с аккаунтом уводит на страницу сотрудника", () => {
    const route = read("../../../../app/(dashboard)/(home)/calendar/masters/[id]/index.tsx");
    assert.match(route, /if \(card\?\.user_id\) \{/);
    assert.match(route, /<Redirect/);
    assert.doesNotMatch(route, /MasterHubScreen/);
    const list = read("../../../../app/(dashboard)/(home)/calendar/masters/index.tsx");
    assert.match(list, /item\.master\.user_id\s*\?\s*`\/calendar\/masters\/access\//);
  });
  test("у каждого календаря своя строка прав, а в «Правах» — только компания", () => {
    const view = read("MasterCardView.tsx");
    assert.match(view, /<SectionCard title="Сотрудник"/);
    assert.match(view, /<CalendarRightsRow/);
    assert.match(view, /area !== "calendar" && area !== "finance"/);
    const member = read("MasterMemberCard.tsx");
    assert.match(member, /calendarLine=\{\(id\) => calendarRightsLine\(blocks, draft, id\)\}/);
  });
  test("права названы словами про человека", () => {
    const map = read("../access-map.ts");
    assert.match(map, /off: "Не видит",\s*read: "Видит",\s*write: "Меняет"/);
    assert.match(read("master-draft.ts"), /export const MIXED_WORD = "Частично";/);
  });
});

describe("страница «Записи» сотрудника — период по его календарям", () => {
  test("окна периода: неделя с понедельника, месяц и год календарные", () => {
    const thu = new Date(2026, 8, 24);
    assert.deepEqual(workWindow("week", thu), { from: "2026-09-21", to: "2026-09-27" });
    assert.deepEqual(workWindow("week", new Date(2026, 8, 27)), { from: "2026-09-21", to: "2026-09-27" });
    assert.deepEqual(workWindow("month", thu), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(workWindow("year", thu), { from: "2026-01-01", to: "2026-12-31" });
  });

  test("итоги и дни: чужой календарь, события и другой период не в счёт", () => {
    const row = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
      id,
      date,
      time_start: "10:00",
      team_id: "A",
      status: "scheduled",
      total_amount: 100,
      ...extra,
    });
    const rows = [
      row("1", "2026-09-02", { status: "completed" }),
      row("2", "2026-09-02", { status: "completed", payment_status: "refunded", time_start: "09:00" }),
      row("3", "2026-09-25"),
      row("4", "2026-09-26", { status: "cancelled" }),
      row("5", "2026-09-25", { team_id: "B" }),
      row("6", "2026-09-25", { kind: "event" }),
      row("7", "2026-10-01"),
    ];
    const got = workOfPeriod(rows, ["A"], workWindow("month", new Date(2026, 8, 24)), "2026-09-24");
    assert.deepEqual(got.summary, { total: 3, done: 2, cancelled: 1, revenue: 100 });
    assert.deepEqual(got.upcoming.map((d) => d.date), ["2026-09-25", "2026-09-26"]);
    assert.deepEqual(got.past.map((d) => d.rows.map((r) => r.id)), [["2", "1"]]);
  });
});
