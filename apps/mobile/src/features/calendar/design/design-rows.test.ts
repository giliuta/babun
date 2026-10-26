import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { designColorRows, eventTypesSubtitle } from "./design-rows";

describe("designColorRows", () => {
  test("ordinary colour first, then cancel, debt, paid — only of enabled blocks", () => {
    const rows = designColorRows({
      ordinary: "#123456",
      objectsOn: false,
      paymentOn: true,
      palette: { unpaid: "#ff0000" },
      cancelled: "#FF2233",
      paid: "#009911",
      prepaid: "#00BBDD",
    });
    assert.deepEqual(
      rows.map((r) => [r.id, r.hue]),
      [
        ["filled", "#123456"],
        ["cancelled", "#FF2233"],
        ["unpaid", "#ff0000"],
        ["paid", "#009911"],
        ["prepaid", "#00BBDD"],
      ],
    );
    assert.equal(rows[2]?.when, "Визит прошёл, а оплаты нет");
    assert.equal(rows[0]?.toggles, false);
  });

  test("payment off drops the debt and the paid colour; no colour reads as null", () => {
    const rows = designColorRows({
      ordinary: "#000000",
      objectsOn: true,
      paymentOn: false,
      palette: {},
      paid: "#009911",
    });
    assert.deepEqual(rows.map((r) => [r.id, r.hue]), [
      ["filled", "#000000"],
      ["cancelled", null],
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
