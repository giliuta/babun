import { describe, expect, test } from "bun:test";
import { findBufferClash, findOverlap } from "./appointment-overlap";

const existing = (over: Record<string, unknown>) => ({
  id: "x",
  date: "2026-10-03",
  time_start: "10:00",
  time_end: "11:00",
  team_id: "t1",
  kind: "work" as const,
  status: "scheduled",
  ...over,
});

const moved = (over: Record<string, unknown> = {}) => ({
  id: "me",
  date: "2026-10-03",
  time_start: "10:30",
  time_end: "11:30",
  team_id: "t1",
  kind: "work" as const,
  ...over,
});

// Перенос по сетке спрашивает, не встала ли запись на чужую работу команды.
describe("findOverlap", () => {
  test("the team's work at the same time is caught", () => {
    const other = existing({ id: "other" });
    expect(findOverlap(moved(), [other])).toBe(other);
  });

  test("the moved record never overlaps itself", () => {
    expect(findOverlap(moved(), [existing({ id: "me" })])).toBeNull();
  });

  test("other teams, cancelled, events and personal never collide", () => {
    expect(
      findOverlap(moved(), [
        existing({ team_id: "t2" }),
        existing({ id: "c", status: "cancelled" }),
        existing({ id: "e", kind: "event" }),
        existing({ id: "p", kind: "personal" }),
      ]),
    ).toBeNull();
  });

  test("no team — nothing to collide with", () => {
    expect(findOverlap(moved({ team_id: null }), [existing({})])).toBeNull();
  });
});

describe("findBufferClash", () => {
  test("a neighbour closer than the buffer is caught", () => {
    const before = existing({ id: "before", time_start: "09:00", time_end: "10:20" });
    expect(findBufferClash(moved({ time_start: "10:25", time_end: "11:00" }), [before], 15)).toBe(before);
  });

  test("no buffer — no clash", () => {
    const before = existing({ id: "before", time_start: "09:00", time_end: "10:20" });
    expect(findBufferClash(moved({ time_start: "10:25", time_end: "11:00" }), [before], 0)).toBeNull();
  });
});
