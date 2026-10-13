import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { designColorRows, eventTypesSubtitle } from "./design-rows";

describe("designColorRows", () => {
  test("ordinary colour first, then only the cases of enabled blocks", () => {
    const rows = designColorRows({ ordinary: "#123456", objectsOn: false, paymentOn: true, palette: { unpaid: "#ff0000" } });
    assert.deepEqual(
      rows.map((r) => [r.id, r.hue]),
      [
        ["filled", "#123456"],
        ["unpaid", "#ff0000"],
      ],
    );
    assert.equal(rows[1]?.when, "Визит прошёл, а оплаты нет");
  });

  test("no colour for a case reads as null", () => {
    const rows = designColorRows({ ordinary: "#000000", objectsOn: true, paymentOn: false, palette: {} });
    assert.deepEqual(rows.map((r) => [r.id, r.hue]), [
      ["filled", "#000000"],
      ["noObject", null],
    ]);
  });
});

describe("eventTypesSubtitle", () => {
  test("loading — nothing, empty — says so, else live names", () => {
    assert.equal(eventTypesSubtitle(true, []), undefined);
    assert.equal(eventTypesSubtitle(false, [{ label: "Отпуск", hidden: true }]), "Типов пока нет");
    assert.equal(
      eventTypesSubtitle(false, [{ label: "Отпуск" }, { label: "Обед", hidden: true }, { label: "Учёба" }]),
      "Отпуск, Учёба",
    );
  });
});
