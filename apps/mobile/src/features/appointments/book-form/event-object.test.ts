import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Location } from "@babun/shared/local/clients";
import { buildBookPatch, type BookPatchInput } from "./book-patch";
import { draftDirty, type DraftDirtyInput } from "./book-dirty";
import {
  EVENT_PLACE_ID,
  hasEventPlace,
  pinOfCoords,
  placeAsLocation,
  placeCoords,
  placeFormValue,
  placeFromForm,
} from "./event-place";

// ОБЪЕКТ В СОБЫТИИ И ЗАМОК ТАРИФА (слова владельца): без клиента «Объект»
// сразу открывает форму, а не список всех объектов; с клиентом — только его
// объекты; без тарифа «Клиент» и «Объект» видны, но серые.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const input = (over: Partial<BookPatchInput> = {}): BookPatchInput => ({
  kind: "event",
  isEdit: false,
  date: "2026-10-29",
  timeStart: "10:00",
  timeEnd: "11:00",
  teamId: "t1",
  city: null,
  clientId: null,
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

describe("1. событие без клиента — объект в самом событии", () => {
  const pin = pinOfCoords(34.6841, 33.0379);
  test("форма → событие → форма: адрес, точка и заметка не теряются", () => {
    const place = placeFromForm({
      type: "",
      target: "Makariou 12",
      parts: {},
      partsOpen: false,
      pin,
      note: "код ворот 42",
    });
    assert.equal(place.address, "Makariou 12");
    assert.equal(place.note, "код ворот 42");
    assert.deepEqual(placeCoords(place.pin), { lat: 34.6841, lng: 33.0379 });
    assert.equal(placeFormValue(place).target, "Makariou 12");
    assert.equal(hasEventPlace(place), true);
    const row = placeAsLocation(place);
    assert.equal(row.id, EVENT_PLACE_ID);
    assert.equal(row.label, "");
    assert.equal(row.note, "код ворот 42");
  });
  test("патч пишет объект в запись, а не в клиента", () => {
    const patch = buildBookPatch(
      input({ eventAddress: "Makariou 12", eventPlacePin: pin, eventPlaceNote: "код ворот 42" }),
    );
    assert.equal(patch.client_id, null);
    assert.equal(patch.location_id, null);
    assert.equal(patch.address, "Makariou 12");
    assert.equal(patch.address_lat, 34.6841);
    assert.equal(patch.address_lng, 33.0379);
    assert.equal(patch.address_note, "код ворот 42");
  });
  test("объект клиента — снимок адреса, своих точки и заметки у записи нет", () => {
    const loc: Location = { id: "l1", label: "Дом", address: "Karpathou 9", isPrimary: true };
    const patch = buildBookPatch(
      input({ clientId: "c1", locationId: "l1", eventLoc: loc, eventPlacePin: pin, eventPlaceNote: "x" }),
    );
    assert.equal(patch.location_id, "l1");
    assert.equal(patch.address, "Karpathou 9");
    assert.equal(patch.address_lat, null);
    assert.equal(patch.address_note, "");
  });
  test("новое событие с одной точкой — уже не пустое (уход спрашивает)", () => {
    const base = {
      kind: "event",
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
    } as DraftDirtyInput;
    assert.equal(draftDirty(base), false);
    assert.equal(draftDirty({ ...base, eventPlacePin: pin }), true);
  });
  test("«Добавить объект» без клиента — сразу форма, без тоста и выбора клиента", () => {
    const picks = read("use-record-picks.ts");
    assert.match(picks, /if \(client && workInPlan\) setObjectSheet\(true\);\s*else setPlaceSheet\(true\);/);
    assert.doesNotMatch(picks, /Объект заводится клиенту — выберите клиента/);
    const sheets = read("BookPickSheets.tsx");
    assert.match(sheets, /<PlaceSheet\s+visible=\{placeSheet\}/);
    assert.match(read("../../clients/ObjectSheet.tsx"), /noType=\{!typed\}/);
  });
});

describe("2–3. с клиентом — только его объекты; чужой — только читать", () => {
  test("без клиента выбирать не из чего, с клиентом — его объекты", () => {
    assert.match(
      read("use-client-locations.ts"),
      /client \? eventLocationPool\.filter\(\(row\) => row\.ownerId === client\.id\) : \[\]/,
    );
  });
  test("списка «объекты всех клиентов» и подписи владельца в выборе нет", () => {
    const block = read("EventObjectBlock.tsx");
    assert.doesNotMatch(block, /Открывает объекты всех клиентов/);
    assert.doesNotMatch(read("BookPickSheets.tsx"), /ownerNameFor/);
    assert.doesNotMatch(read("../../clients/ObjectPickerSheet.tsx"), /ownerNameFor/);
  });
  test("старое событие с объектом чужого клиента — показывается, но не меняется", () => {
    const block = read("EventObjectBlock.tsx");
    assert.match(block, /const foreign = !!eventLocationEntry && eventLocationEntry\.ownerId !== clientId;/);
    assert.match(block, /can\.editObject && !foreign/);
    assert.match(block, /readOnly=\{!clientObjectsWritable \|\| foreign\}/);
  });
  test("клиента сняли — его объект уходит с ним", () => {
    const picks = read("use-record-picks.ts");
    assert.match(picks, /const clearClient = \(\) => \{\s*setClientId\(null\);\s*dropClientObject\(\);/);
  });
});

describe("неоплаченный календарь: событие работает, клиент серый, объект события — свой", () => {
  test("a. само событие тарифом не заперто — только запись клиента", () => {
    const rights = read("../record-blocks/book-rights.ts");
    assert.match(rights, /if \(input\.kind === "work"\) return !input\.workInPlan;\s*return !input\.isMember && !input\.ownEvent;/);
  });
  test("b. объект события без тарифа доступен; серым — только объект клиента", () => {
    const block = read("EventObjectBlock.tsx");
    assert.match(block, /const clientObjects = workInPlan;/);
    assert.match(block, /return !clientObjects && eventLocationEntry \? \(\s*<TariffLocked locked>\{block\}<\/TariffLocked>/);
    assert.doesNotMatch(block, /return workInPlan \? block : <TariffLocked locked>/);
    // Без тарифа «Добавить объект» — форма объекта события, не объект клиента.
    assert.match(read("use-record-picks.ts"), /if \(client && workInPlan\) setObjectSheet\(true\);\s*else setPlaceSheet\(true\);/);
    assert.match(block, /objectClientId && eventPickPool\.length > 0/);
  });
  test("c. «Клиент» виден, но серый; тап — плашка тарифа", () => {
    const body = read("EventBody.tsx");
    assert.doesNotMatch(body, /\(workInPlan \|\| client\)/);
    assert.match(body, /<TariffLocked locked=\{!workInPlan\}>\s*<SmsComposeProvider/);
    assert.match(read("../../tariffs/TariffLocked.tsx"), /const nudge = useTariffNudge\(\);/);
  });
  test("d. запись с клиентом без тарифа — только смотреть, оплата серая", () => {
    assert.match(read("use-book-rights.ts"), /const can = readOnly \? readOnlyBookRights\(rights\) : rights;/);
    assert.match(read("../payment-block/use-payment-block.ts"), /const bookingInPlan = usePlanAllows\("book-clients"\);/);
  });
  test("один замок тарифа формы — `workInPlan`", () => {
    assert.match(read("use-book-form.ts"), /ОДНО МЕСТО ЗАМКА ТАРИФА ФОРМЫ[\s\S]{0,400}const workInPlan = usePlanAllows\("book-clients"\);/);
  });
  test("e. сервер отказывает только на клиенте и объекте клиента", () => {
    const sql = readFileSync(
      resolve(here, "../../../../../../supabase/migrations/20261029090000_free_event_without_client_refs.sql"),
      "utf8",
    );
    assert.match(sql, /if new\.client_id is not null or new\.location_id is not null then/);
    assert.doesNotMatch(sql, /new\.address_lat is not null/);
    assert.doesNotMatch(sql, /address_note, ''\) <> ''/);
  });
});
