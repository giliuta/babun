import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBlankAppointment,
  type Appointment,
} from "@babun/shared/local/appointments";
import {
  agendaMonthSections,
  expandWithOccurrenceCache,
  groupByDate,
  reminderSignature,
  type OccurrenceCache,
} from "./grouping";

const apt = (id: string, date: string, time_start: string, extra: Partial<Appointment> = {}) =>
  createBlankAppointment({ id, date, time_start, ...extra });

describe("groupByDate", () => {
  test("buckets by date and keeps input order inside a day", () => {
    const list = [apt("a", "2026-10-02", "12:00"), apt("b", "2026-10-01", "09:00"), apt("c", "2026-10-02", "08:00")];
    const m = groupByDate(list);
    assert.deepEqual([...m.keys()], ["2026-10-02", "2026-10-01"]);
    assert.deepEqual(m.get("2026-10-02")?.map((a) => a.id), ["a", "c"]);
    assert.deepEqual(m.get("2026-10-01")?.map((a) => a.id), ["b"]);
    assert.equal(m.get("2026-10-03"), undefined);
  });

  test("empty input gives an empty map", () => {
    assert.equal(groupByDate([]).size, 0);
  });
});

describe("agendaMonthSections", () => {
  test("whole month only, sorted by date then start, one section per day", () => {
    const list = [
      apt("late", "2026-10-31", "18:00"),
      apt("prev", "2026-09-30", "10:00"),
      apt("second", "2026-10-05", "14:00"),
      apt("next", "2026-11-01", "08:00"),
      apt("first", "2026-10-05", "09:30"),
      apt("start", "2026-10-01", "00:00"),
    ];
    const sections = agendaMonthSections(list, new Date(2026, 9, 1));
    assert.deepEqual(
      sections.map((s) => [s.title, s.data.map((a) => a.id)]),
      [
        ["2026-10-01", ["start"]],
        ["2026-10-05", ["first", "second"]],
        ["2026-10-31", ["late"]],
      ],
    );
  });

  test("does not reorder the caller's array", () => {
    const list = [apt("b", "2026-10-02", "10:00"), apt("a", "2026-10-01", "10:00")];
    agendaMonthSections(list, new Date(2026, 9, 1));
    assert.deepEqual(list.map((a) => a.id), ["b", "a"]);
  });
});

describe("reminderSignature", () => {
  test("changes with date, time, status, team or push flag — not with other fields", () => {
    const base = apt("a", "2026-10-02", "10:00", { team_id: "t1" });
    const sig = reminderSignature([base]);
    assert.equal(reminderSignature([{ ...base, comment: "другое" }]), sig);
    assert.notEqual(reminderSignature([{ ...base, date: "2026-10-03" }]), sig);
    assert.notEqual(reminderSignature([{ ...base, time_start: "11:00" }]), sig);
    assert.notEqual(reminderSignature([{ ...base, status: "cancelled" }]), sig);
    assert.notEqual(reminderSignature([{ ...base, team_id: "t2" }]), sig);
    assert.notEqual(reminderSignature([{ ...base, event_push_enabled: true }]), sig);
  });
});

describe("expandWithOccurrenceCache", () => {
  const seed = apt("seed", "2026-10-01", "10:00", {
    kind: "event",
    event_repeat: { kind: "daily", count: 3 },
  });
  const single = apt("single", "2026-10-02", "12:00");

  test("non-repeating records pass through, repeats expand into the window", () => {
    const { list } = expandWithOccurrenceCache([single, seed], "2026-09-01", "2026-12-31", new Map());
    assert.equal(list[0], single);
    assert.deepEqual(
      list.slice(1).map((a) => a.date),
      ["2026-10-01", "2026-10-02", "2026-10-03"],
    );
  });

  test("occurrences keep their object while the seed is the same object", () => {
    const first = expandWithOccurrenceCache([seed], "2026-09-01", "2026-12-31", new Map());
    const second = expandWithOccurrenceCache([seed], "2026-09-01", "2026-12-31", first.cache);
    assert.equal(second.list.length, first.list.length);
    second.list.forEach((occ, i) => assert.equal(occ, first.list[i]));
  });

  test("a changed seed gives new occurrence objects", () => {
    const first = expandWithOccurrenceCache([seed], "2026-09-01", "2026-12-31", new Map());
    const moved = { ...seed, time_start: "11:00" };
    const second = expandWithOccurrenceCache([moved], "2026-09-01", "2026-12-31", first.cache);
    const virtual = second.list.filter((a) => a.id !== moved.id);
    assert.ok(virtual.length > 0);
    for (const occ of virtual) assert.ok(!first.list.includes(occ));
  });

  test("the next cache holds only occurrences of this pass", () => {
    const stale: OccurrenceCache = new Map([["gone@2026-01-01", { seed, occ: seed }]]);
    const { cache } = expandWithOccurrenceCache([seed], "2026-09-01", "2026-12-31", stale);
    assert.equal(cache.has("gone@2026-01-01"), false);
  });
});
