import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findBufferClash,
  findOverlap,
} from "@babun/shared/common/utils/appointment-overlap";
import { draftSlot } from "./draft-slot";

// Плашки формы записи обязаны загораться на чужую работу команды и молчать
// на саму правящуюся запись.

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

const slot = (over: Partial<Parameters<typeof draftSlot>[0]> = {}) =>
  draftSlot({
    editId: null,
    teamId: "t1",
    date: "2026-10-03",
    timeStart: "10:30",
    timeEnd: "11:30",
    ...over,
  });

describe("draftSlot", () => {
  test("new record overlapping the team's work is caught", () => {
    const other = existing({ id: "other" });
    assert.equal(findOverlap(slot(), [other]), other);
  });

  test("the edited record never overlaps itself", () => {
    const self = existing({ id: "rec-1", time_start: "10:30", time_end: "11:30" });
    assert.equal(findOverlap(slot({ editId: "rec-1" }), [self]), null);
  });

  test("another team's work is not an overlap", () => {
    assert.equal(findOverlap(slot(), [existing({ team_id: "t2" })]), null);
  });

  test("no team — nothing to collide with", () => {
    assert.equal(findOverlap(slot({ teamId: null }), [existing({})]), null);
  });

  test("buffer clash is caught against the team's neighbour", () => {
    const before = existing({ id: "before", time_start: "09:00", time_end: "10:20" });
    const tight = slot({ timeStart: "10:25", timeEnd: "11:00" });
    assert.equal(findBufferClash(tight, [before], 15), before);
  });
});
