import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// КОМАНДНОЕ СОБЫТИЕ ПРОТИВ СОБЫТИЯ ТОЙ ЖЕ КОМАНДЫ: те же люди в то же время —
// форма события обязана предупредить, как обещает `use-slot-warnings.ts`.
// Перенос по сетке флага не передаёт и по-прежнему событий не видит.
describe("team event form", () => {
  const teamEvent = existing({ id: "e1", kind: "event" as const });

  test("an event of the same team overlaps a team event draft", () => {
    assert.equal(findOverlap(slot(), [teamEvent], { withTeamEvents: true }), teamEvent);
  });

  test("without the flag (grid reschedule) events stay invisible", () => {
    assert.equal(findOverlap(slot(), [teamEvent]), null);
  });

  test("personal events and other teams' events never collide", () => {
    const personal = existing({ id: "p1", kind: "personal" as const });
    const foreign = existing({ id: "e2", kind: "event" as const, team_id: "t2" });
    assert.equal(findOverlap(slot(), [personal, foreign], { withTeamEvents: true }), null);
  });

  test("the booking form turns the flag on for an event", () => {
    const src = readFileSync(join(__dirname, "book-form/use-slot-warnings.ts"), "utf8");
    assert.match(src, /\{ withTeamEvents: kind === "event" \}/);
    const form = readFileSync(join(__dirname, "book-form/use-book-form.ts"), "utf8");
    const call = form.slice(form.indexOf("useSlotWarnings({"));
    assert.match(call.slice(0, call.indexOf("});")), /\bkind,/);
  });

  test("the warning names what it collided with", () => {
    const src = readFileSync(join(__dirname, "book-form/use-save-state.ts"), "utf8");
    assert.match(
      src,
      /overlap\.kind === "event"\s*\? "Пересекается с событием этой команды"\s*: "Пересекается с работой этой команды"/,
    );
  });
});
