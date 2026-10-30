import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildBookPatch, type BookPatchInput } from "./book-patch";
import { isMissingTypeColumn, placeAsLocation, placeFormValue, placeTypeId, placeTypeName } from "./event-place";

// ТИП ОБЪЕКТА — ШТОРКОЙ, И У ОБЪЕКТА СОБЫТИЯ (слова владельца): тап по типу
// открывает шторку выбора, а не раскрывашку; объект события без клиента тоже
// получает тип — из «Типов объектов» своей команды, после наката колонки.

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), "utf8");

const input = (over: Partial<BookPatchInput> = {}): BookPatchInput =>
  ({
    kind: "event",
    isEdit: false,
    date: "2026-10-30",
    timeStart: "10:00",
    timeEnd: "11:00",
    teamId: "t1",
    city: null,
    clientId: null,
    locationId: null,
    eventLoc: null,
    eventAddress: "Makariou 12",
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
  }) as BookPatchInput;

describe("1. тип объекта — шторкой поверх листа", () => {
  test("тап открывает шторку выбора, а не список внутри формы", () => {
    const fields = read("../../clients/ObjectFields.tsx");
    assert.match(fields, /<ValuePickerSheet\s+visible=\{typeSheetOpen\}\s+overlayIfStacked/);
    assert.match(fields, /setTypeSheetOpen\(true\);/);
    assert.doesNotMatch(fields, /setTypeSheetOpen\(\(open\) => !open\)/);
    assert.doesNotMatch(fields, /\{typeSheetOpen && !noType \? \(/);
  });
  test("шторка ложится в окно листа — второго модального окна нет", () => {
    assert.match(read("../../../components/ui/ValuePickerSheet.tsx"), /overlayIfStacked=\{overlayIfStacked\}/);
  });
  test("повторный тап снимает тип, пустой справочник ведёт в «Типы объектов»", () => {
    const fields = read("../../clients/ObjectFields.tsx");
    assert.match(fields, /onChange\(\{ type: name \? snapObjectType\(name, typeOptions\) : "" \}\)/);
    assert.match(fields, /onSettings=\{onTypeSettings\}/);
    assert.match(fields, /emptyLabel="Типов объектов пока нет"/);
  });
  test("тип ставится, когда шторка уехала: форма не перестраивается в кадре её ухода", () => {
    const fields = read("../../clients/ObjectFields.tsx");
    // Тап только запоминает выбор — форму он не трогает.
    assert.match(fields, /onPick=\{\(name\) => \{\s*pickedTypeRef\.current = name;\s*\}\}/);
    // Применение — в `onExited`, после снятия шторки.
    assert.match(
      fields,
      /onExited=\{\(\) => \{\s*const name = pickedTypeRef\.current;\s*pickedTypeRef\.current = undefined;\s*if \(name === undefined\) return;\s*onChange\(\{ type:/,
    );
    assert.match(read("../../../components/ui/ValuePickerSheet.tsx"), /onExited=\{onExited\}/);
  });
});

describe("2. тип у объекта события", () => {
  const presets = [
    { id: "lbl-house", name: "Дом" },
    { id: "lbl-office", name: "Офис" },
  ];
  test("имя из формы ↔ id справочника; удалённый тип — без типа", () => {
    assert.equal(placeTypeId(presets, "дом "), "lbl-house");
    assert.equal(placeTypeId(presets, ""), null);
    assert.equal(placeTypeId(presets, "Склад"), null);
    assert.equal(placeTypeName(presets, "lbl-office"), "Офис");
    assert.equal(placeTypeName(presets, "lbl-gone"), "");
  });
  test("строка и форма объекта события несут тип", () => {
    const place = { address: "Makariou 12", pin: "", note: "" };
    assert.equal(placeAsLocation(place, "Дом").label, "Дом");
    assert.equal(placeFormValue(place, "Дом").type, "Дом");
  });
  test("после наката тип уходит в запись; у объекта клиента — снят", () => {
    const live = buildBookPatch(input({ eventPlaceTypeId: "lbl-house", eventPlaceTypeLive: true }));
    assert.equal(live.address_object_type_id, "lbl-house");
    const clientObject = buildBookPatch(
      input({
        eventPlaceTypeId: "lbl-house",
        eventPlaceTypeLive: true,
        clientId: "c1",
        locationId: "l1",
        eventLoc: { id: "l1", label: "Дом", address: "Karpathou 9", isPrimary: true },
      }),
    );
    assert.equal(clientObject.address_object_type_id, null);
  });
  test("до наката поля нет в патче — сохранение не падает на незнакомой колонке", () => {
    const before = buildBookPatch(input({ eventPlaceTypeId: "lbl-house", eventPlaceTypeLive: false }));
    assert.equal("address_object_type_id" in before, false);
    assert.equal(isMissingTypeColumn({ code: "PGRST204", message: "" }), true);
    assert.equal(isMissingTypeColumn({ code: "42703", message: "" }), true);
    assert.equal(isMissingTypeColumn({ code: "42501", message: "permission denied" }), false);
  });
  test("в базу поле уходит, только если задано", () => {
    const rows = read("../../../../../../packages/shared/src/db/repositories/appointments/rows.ts");
    assert.match(rows, /\.\.\.\(a\.address_object_type_id !== undefined/);
    assert.match(rows, /if \(patch\.address_object_type_id !== undefined\)/);
  });
});

describe("изоляция типов объекта события", () => {
  test("тип — только из справочника команды события; без команды — без типа", () => {
    const sheet = read("../../clients/ObjectSheet.tsx");
    assert.match(sheet, /const typed = withType && !!teamId;/);
    assert.match(sheet, /const typeOptions = useObjectTypeOptions\(typed \? teamId : null\);/);
    assert.match(read("use-book-form.ts"), /const \{ data: placeTypePresets = \[\] \} = useLocationLabels\(teamId\);/);
    assert.match(read("BookPickSheets.tsx"), /teamId=\{teamId\}\s+withType=\{eventPlaceTypeLive\}/);
  });
  test("сервер: тип только живой команды записи, удалённый тип снимается", () => {
    const sql = readFileSync(
      resolve(here, "../../../../../../supabase/migrations/20261030120000_event_place_object_type.sql"),
      "utf8",
    );
    assert.match(sql, /references public\.location_labels \(tenant_id, id\)\s+on delete set null \(address_object_type_id\)/);
    assert.match(sql, /and ll\.team_id = new\.team_id/);
    assert.match(sql, /and t\.is_active/);
    assert.match(sql, /hint = 'event:object_type_other_team'/);
  });
});
