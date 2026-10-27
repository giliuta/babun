import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Location } from "@babun/shared/local/clients";
import { buildBookPatch, type BookPatchInput } from "./book-patch";

const loc = (id: string, address: string): Location => ({ id, label: "Дом", address, isPrimary: false });

const input = (over: Partial<BookPatchInput> = {}): BookPatchInput => ({
  kind: "work",
  isEdit: false,
  date: "2026-10-05",
  timeStart: "10:00",
  timeEnd: "11:30",
  teamId: "t1",
  city: null,
  clientId: "c1",
  locationId: null,
  eventLoc: null,
  eventAddress: "",
  allDay: false,
  repeat: { kind: "none" },
  eventNotes: "",
  eventUrl: "",
  eventReminderOffset: null,
  eventTypeLabel: null,
  eventTitle: "",
  eventColor: null,
  masterId: null,
  serviceIds: [],
  selectedServices: [],
  effectiveTotal: 0,
  customTotal: false,
  computedDuration: 0,
  comment: "",
  status: "scheduled",
  clientLocations: [],
  address: "",
  colorOverride: null,
  globalDiscount: null,
  discountAmount: 0,
  recordVatMode: "none",
  vatRateInUse: 19,
  reminderOn: false,
  client: null,
  ...over,
});

describe("buildBookPatch — event", () => {
  test("an event is named by its type, else its old title, else «Событие»", () => {
    const ev = (over: Partial<BookPatchInput>) => buildBookPatch(input({ kind: "event", ...over }));
    assert.equal(ev({ eventTypeLabel: "Офис", eventTitle: "старое" }).comment, "Офис");
    assert.equal(ev({ eventTitle: "  старое  " }).comment, "старое");
    assert.equal(ev({}).comment, "Событие");
  });

  test("never carries work fields; master is cleared", () => {
    const patch = buildBookPatch(input({ kind: "event", masterId: "m1", serviceIds: ["s1"] }));
    assert.equal(patch.kind, "event");
    assert.equal(patch.master_id, null);
    assert.deepEqual(patch.service_ids, []);
    assert.equal(patch.total_amount, 0);
    assert.equal(patch.global_discount, null);
  });

  test("a picked object gives the address; a free map link goes to event_url", () => {
    const withObject = buildBookPatch(
      input({ kind: "event", eventLoc: loc("l1", "Karpathou 9"), eventAddress: "old" }),
    );
    assert.equal(withObject.address, "Karpathou 9");
    const withLink = buildBookPatch(
      input({ kind: "event", eventAddress: "https://maps.app.goo.gl/abc" }),
    );
    assert.equal(withLink.address, "");
    assert.equal(withLink.event_url, "https://maps.app.goo.gl/abc");
  });

  test("the reminder offset becomes the push list", () => {
    const patch = buildBookPatch(input({ kind: "event", eventReminderOffset: 30 }));
    assert.equal(patch.event_push_enabled, true);
    assert.deepEqual(patch.event_push_offsets, [30]);
  });
});

describe("buildBookPatch — work", () => {
  test("no catalog duration → the slot length is stored", () => {
    assert.equal(buildBookPatch(input()).total_duration, 90);
    assert.equal(buildBookPatch(input({ computedDuration: 45 })).total_duration, 45);
    // Конец упёрся в 23:59 — длительность не длиннее слота.
    assert.equal(
      buildBookPatch(input({ computedDuration: 120, timeStart: "22:30", timeEnd: "23:59" })).total_duration,
      89,
    );
  });

  test("the note and the address are trimmed", () => {
    const patch = buildBookPatch(input({ comment: "  ключ у соседей ", address: " Main 1 " }));
    assert.equal(patch.comment, "ключ у соседей");
    assert.equal(patch.address, "Main 1");
  });

  test("a new record drops an object id the client no longer has; an edit keeps it", () => {
    const gone = input({ locationId: "l9", clientLocations: [loc("l1", "a")] });
    assert.equal(buildBookPatch(gone).location_id, null);
    assert.equal(buildBookPatch({ ...gone, isEdit: true }).location_id, "l9");
    assert.equal(
      buildBookPatch(input({ locationId: "l1", clientLocations: [loc("l1", "a")] })).location_id,
      "l1",
    );
  });

  test("VAT is written only for a computed total", () => {
    const vat = buildBookPatch(input({ recordVatMode: "exclusive" }));
    assert.equal(vat.vat_mode, "exclusive");
    assert.equal(vat.vat_rate, 19);
    const zeroRate = buildBookPatch(input({ recordVatMode: "exclusive", vatRateInUse: 0 }));
    assert.equal(zeroRate.vat_mode, "none");
    assert.equal(zeroRate.vat_rate, null);
    const custom = buildBookPatch(input({ recordVatMode: "exclusive", customTotal: true }));
    assert.equal("vat_mode" in custom, false);
  });

  test("a custom total drops the discount: it takes nothing off a typed sum", () => {
    const discount = { type: "fixed" as const, value: 10 };
    const custom = buildBookPatch(input({ customTotal: true, globalDiscount: discount, discountAmount: 10 }));
    assert.equal(custom.global_discount, null);
    assert.equal(custom.discount_amount, 0);
    const computed = buildBookPatch(input({ globalDiscount: discount, discountAmount: 10 }));
    assert.deepEqual(computed.global_discount, discount);
    assert.equal(computed.discount_amount, 10);
  });

  test("the SMS reminder needs a phone, or a hidden-contacts client", () => {
    const on = (client: BookPatchInput["client"]) =>
      buildBookPatch(input({ reminderOn: true, client })).reminder_enabled;
    assert.equal(on(null), false);
    assert.equal(on({ phone: "+35799000000", contacts_hidden: undefined }), true);
    assert.equal(on({ phone: "", contacts_hidden: "right" }), true);
    assert.equal(on({ phone: "", contacts_hidden: null }), true);
    assert.equal(on({ phone: "", contacts_hidden: undefined }), false);
  });
});
