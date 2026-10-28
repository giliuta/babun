import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createBlankAppointment, type Appointment } from "@babun/shared/local/appointments";
import { layoutDay } from "../layout";
import { blockLayout } from "./block-layout";

const one = (time_start: string, time_end: string, status?: Appointment["status"]) => {
  const apt = createBlankAppointment({ id: "A", date: "2026-10-13", time_start, time_end });
  return layoutDay([status ? { ...apt, status } : apt])[0];
};

const base = {
  laneW: 320,
  startHour: 0,
  endHour: 24,
  hourH: 60,
  lineH: 16,
  label: "Анна Петрова",
  service: "Чистка",
  offLabelColor: null,
  editing: false,
  overdue: false,
  reschedulable: true,
};

describe("blockLayout", () => {
  test("an hour in a wide day column: full ladder, wide padding", () => {
    const l = blockLayout({ ...base, placed: one("10:00", "11:00") });
    assert.equal(l.cardH, 58);
    assert.equal(l.pad, 6);
    assert.equal(l.markSize, 8);
    assert.equal(l.textW, l.width - 2 * 6 - 2, "no corner mark eats the text width");
    assert.equal(l.showTime, true);
    assert.equal(l.showService, true);
    assert.equal(l.rowsFit, 3);
    assert.equal(l.lastRow, "service");
  });

  test("a block before the window pins to its top", () => {
    const l = blockLayout({ ...base, startHour: 8, placed: one("07:00", "09:00") });
    assert.equal(l.visStart, 480);
    assert.equal(l.visEnd, 540);
    assert.equal(l.totalMin, 16 * 60);
  });

  test("completed: an off label gets the dot", () => {
    const l = blockLayout({ ...base, offLabelColor: "#f00", placed: one("10:00", "12:00", "completed") });
    assert.equal(l.dotReserve, 12);
    assert.equal(l.completed, true);
    assert.equal(l.textW, l.width - 2 * 6 - 2);
  });

  test("a cancelled record has no fading tail", () => {
    const l = blockLayout({
      ...base,
      label: "Константин Константинопольский",
      placed: one("10:00", "12:00", "cancelled"),
    });
    assert.deepEqual(l.fadeRows, []);
  });

  test("resize handles only in edit mode of a movable, live record", () => {
    const placed = one("10:00", "11:00");
    assert.equal(blockLayout({ ...base, placed }).topHandle, 0);
    const editing = blockLayout({ ...base, editing: true, placed });
    assert.equal(editing.topHandle, 6);
    assert.equal(editing.bottomHandle, 6);
    assert.equal(blockLayout({ ...base, editing: true, reschedulable: false, placed }).topHandle, 0);
    const cancelled = blockLayout({ ...base, editing: true, placed: one("10:00", "11:00", "cancelled") });
    assert.equal(cancelled.topHandle, 0);
    assert.equal(cancelled.cancelled, true);
  });

  test("narrow week column: one name row that fades, narrow padding", () => {
    const l = blockLayout({ ...base, laneW: 50, placed: one("10:00", "12:00") });
    assert.equal(l.pad, 3);
    assert.equal(l.showTime, true);
    assert.ok(l.fadeRows.includes(0), "a long name fades instead of wrapping");
  });

  test("top card of a deck carries «+N»; low card puts it on the name row", () => {
    const tall = blockLayout({ ...base, laneW: 50, deckIndex: 2, deckSize: 3, placed: one("10:00", "11:00") });
    assert.equal(tall.deckMore, 2);
    assert.equal(tall.deckBadgeLow, true);
    const short = blockLayout({ ...base, laneW: 50, hourH: 20, deckIndex: 2, deckSize: 3, placed: one("10:00", "11:00") });
    assert.equal(short.deckBadgeLow, false);
    assert.equal(short.nameLineW, short.textW - short.deckBadgeW);
    const under = blockLayout({ ...base, laneW: 50, deckIndex: 0, deckSize: 3, placed: one("10:00", "11:00") });
    assert.equal(under.deckMore, 0);
  });
});
