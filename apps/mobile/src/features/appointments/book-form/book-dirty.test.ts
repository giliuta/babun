import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { draftDirty, type DraftDirtyInput } from "./book-dirty";

const pristine = (over: Partial<DraftDirtyInput> = {}): DraftDirtyInput => ({
  kind: "work",
  notesDirty: false,
  clientId: null,
  locationId: null,
  eventTypeId: null,
  pendingFilesCount: 0,
  eventTitle: "",
  eventNotes: "",
  eventAddress: "",
  eventUrl: "",
  eventReminderOffset: null,
  eventColor: null,
  repeat: { kind: "none" },
  allDay: false,
  dateTouched: false,
  durationTouched: false,
  serviceIdsCount: 0,
  comment: "",
  address: "",
  customTotal: false,
  discountValue: "",
  recordVatMode: "none",
  status: "scheduled",
  reminderOn: false,
  hasPendingPayment: false,
  colorOverride: null,
  cityTouched: false,
  ...over,
});

describe("draftDirty — new record", () => {
  test("an untouched form closes silently", () => {
    assert.equal(draftDirty(pristine()), false);
  });

  test("each thing a person can enter counts", () => {
    const touched: Partial<DraftDirtyInput>[] = [
      { notesDirty: true },
      { clientId: "c1" },
      { serviceIdsCount: 1 },
      { comment: "x" },
      { address: "a" },
      { customTotal: true },
      { discountValue: "5" },
      { recordVatMode: "exclusive" },
      { status: "completed" },
      { reminderOn: true },
      { hasPendingPayment: true },
      { pendingFilesCount: 1 },
      { colorOverride: "#ff0000" },
      { cityTouched: true },
      { dateTouched: true },
      { durationTouched: true },
    ];
    for (const over of touched) assert.equal(draftDirty(pristine(over)), true, JSON.stringify(over));
  });

  test("a discount unit without a number is not an edit; blanks are not text", () => {
    assert.equal(draftDirty(pristine({ discountValue: "0" })), false);
    assert.equal(draftDirty(pristine({ comment: "   " })), false);
    // Event-only fields do not make a record dirty.
    assert.equal(draftDirty(pristine({ eventTitle: "x", locationId: "l1" })), false);
  });
});

describe("draftDirty — new event", () => {
  test("counts the client, the object, the type and the files too", () => {
    const ev = (over: Partial<DraftDirtyInput>) => draftDirty(pristine({ kind: "event", ...over }));
    assert.equal(ev({}), false);
    for (const over of [
      { clientId: "c1" },
      { locationId: "l1" },
      { eventTypeId: "et1" },
      { pendingFilesCount: 2 },
      { eventTitle: "x" },
      { eventNotes: "x" },
      { eventAddress: "x" },
      { eventUrl: "x" },
      { eventReminderOffset: 0 },
      { eventColor: "#000000" },
      { repeat: { kind: "daily" as const } },
      { allDay: true },
      { dateTouched: true },
      { durationTouched: true },
      { notesDirty: true },
    ]) {
      assert.equal(ev(over), true, JSON.stringify(over));
    }
    // Record-only fields do not make an event dirty.
    assert.equal(ev({ serviceIdsCount: 2, comment: "x", cityTouched: true }), false);
  });
});
